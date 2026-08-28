// The sign-in door: what it emails, and what its two callbacks are allowed to do.
//
// Three separate guards live here, and each one is invisible in a diff — they
// are all a thing NOT happening. The GET must not write (mail scanners follow
// it); the POST must not mint twice for one token (D1 has no read-then-write
// transaction); and neither budget may change the answer the caller sees
// (invariant 4). Tests are the only place those three facts are stated.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { auth as authRoutes } from "../src/routes/auth.js";
import type { HonoEnv } from "../src/env.js";

interface Row {
  sql: string;
  args: unknown[];
}

interface Opts {
  /** Rows counted by the rolling-day budget query. */
  sentToday?: { total: number; mine: number };
  /** null = no such token; otherwise the auth_token row. */
  token?: Record<string, unknown> | null;
  /** false = the guarded consume UPDATE reports zero rows changed. */
  consumeWins?: boolean;
}

function testEnv(writes: Row[], opts: Opts = {}): HonoEnv["Bindings"] {
  const token =
    opts.token === undefined
      ? {
          id: "01TOKEN",
          email: "parent@example.com",
          kind: "signin",
          person_id: null,
          invited_by: null,
          reg_open_at_issue: 1,
          expires_at: "2099-01-01T00:00:00.000Z",
          consumed_at: null,
          return_to: null,
        }
      : opts.token;

  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM auth_token")) {
        // The budget query and the token lookup both read auth_token.
        if (sql.includes("COUNT(*)")) {
          return { total: opts.sentToday?.total ?? 0, mine: opts.sentToday?.mine ?? 0 };
        }
        return token;
      }
      if (sql.includes("disabled_at FROM user")) return { disabled_at: null };
      if (sql.includes("FROM user")) {
        return { id: "01USER", email: "parent@example.com", is_system_admin: 0, locale: null };
      }
      if (sql.includes("FROM setting")) return { value: "true" };
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      writes.push({ sql, args: this.args });
      const isConsume = sql.includes("UPDATE auth_token SET consumed_at");
      return { meta: { changes: isConsume && opts.consumeWins === false ? 0 : 1 } };
    },
  });

  return {
    APP_URL: "http://localhost:5173",
    ALLOWED_ORIGINS: "http://localhost:5173",
    SCHOOL_NAME: "Eisenhower PTO",
    DB: { prepare: (sql: string) => mk(sql), async batch() { return []; } },
  } as unknown as HonoEnv["Bindings"];
}

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    await next();
  }));
  a.route("/auth", authRoutes);
  return a;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const get = (env: HonoEnv["Bindings"], t = "sometoken") =>
  app().request(`/auth/callback?t=${t}`, {}, env, ctx);

const post = (env: HonoEnv["Bindings"]) =>
  app().request(
    "/auth/callback",
    { method: "POST", body: new URLSearchParams({ t: "sometoken" }) },
    env,
    ctx,
  );

const start = (env: HonoEnv["Bindings"], email = "parent@example.com") =>
  app().request(
    "/auth/start",
    { method: "POST", body: JSON.stringify({ email }), headers: { "Content-Type": "application/json" } },
    env,
    ctx,
  );

/** Writes are `run()` calls; reads never reach this list. */
const wrote = (writes: Row[], fragment: string) => writes.some((w) => w.sql.includes(fragment));

describe("GET /auth/callback is read-only — a mail scanner must not spend the link", () => {
  it("writes nothing at all", async () => {
    const writes: Row[] = [];
    const res = await get(testEnv(writes));
    expect(res.status).toBe(200);
    // The whole point. Not "mints no session" — writes NOTHING, so the token is
    // still there when the human clicks.
    expect(writes).toEqual([]);
  });

  it("hands back a form that posts the token back, and asks not to be cached", async () => {
    const res = await get(testEnv([]));
    const html = await res.text();
    expect(html).toContain('method="POST"');
    expect(html).toContain('action="/auth/callback"');
    expect(html).toContain('value="sometoken"');
    // Holding the token is the authorization, so no shared cache may keep it.
    expect(res.headers.get("cache-control")).toBe("no-store");
    // A page reached by a secret in the URL must not leak that URL onward.
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("escapes the token into the form rather than trusting its charset", async () => {
    const res = await get(testEnv([]), "a%22%3E%3Cscript%3E");
    const html = await res.text();
    expect(html).not.toContain("<script>a");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("redirects a spent link instead of offering a button that can't work", async () => {
    const res = await get(testEnv([], { token: { consumed_at: "2026-01-01T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z", return_to: null } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:5173/sign-in?error=link");
  });

  it("redirects an expired link", async () => {
    const res = await get(testEnv([], { token: { consumed_at: null, expires_at: "2020-01-01T00:00:00.000Z", return_to: null } }));
    expect(res.status).toBe(302);
  });

  it("redirects an unknown token, saying nothing about why", async () => {
    const res = await get(testEnv([], { token: null }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:5173/sign-in?error=link");
  });
});

describe("POST /auth/callback consumes the token exactly once", () => {
  it("signs in, and claims the token with a guard rather than a bare UPDATE", async () => {
    const writes: Row[] = [];
    const res = await post(testEnv(writes));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("error=link");
    expect(wrote(writes, "INSERT INTO session")).toBe(true);
    // The read above the UPDATE is a fast path; the WHERE is the actual guard.
    const consume = writes.find((w) => w.sql.includes("UPDATE auth_token SET consumed_at"));
    expect(consume?.sql).toContain("consumed_at IS NULL");
  });

  it("mints no session when a concurrent click already claimed the token", async () => {
    // The row still read as unconsumed — this is exactly the race the guard is
    // for — but the UPDATE changed nothing, so this request lost.
    const writes: Row[] = [];
    const res = await post(testEnv(writes, { consumeWins: false }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:5173/sign-in?error=link");
    expect(wrote(writes, "INSERT INTO session")).toBe(false);
  });
});

describe("POST /auth/start budgets its sends without becoming an oracle", () => {
  it("sends under the caps", async () => {
    const writes: Row[] = [];
    const res = await start(testEnv(writes, { sentToday: { total: 4, mine: 1 } }));
    expect(res.status).toBe(200);
    expect(wrote(writes, "INSERT INTO auth_token")).toBe(true);
  });

  it("suppresses a sixth link to one address", async () => {
    const writes: Row[] = [];
    const res = await start(testEnv(writes, { sentToday: { total: 10, mine: 5 } }));
    expect(wrote(writes, "INSERT INTO auth_token")).toBe(false);
    // No row means no trace, so replaying the form can neither reset the window
    // nor grow the table.
    expect(writes).toEqual([]);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("suppresses everything once the instance-wide ceiling is hit", async () => {
    const writes: Row[] = [];
    await start(testEnv(writes, { sentToday: { total: 300, mine: 0 } }), "someone-else@example.com");
    expect(wrote(writes, "INSERT INTO auth_token")).toBe(false);
  });

  it("answers identically whether it sent, suppressed, or never had the address", async () => {
    const sent = await start(testEnv([], { sentToday: { total: 0, mine: 0 } }));
    const capped = await start(testEnv([], { sentToday: { total: 900, mine: 9 } }));
    const junk = await start(testEnv([]), "not-an-email");
    for (const res of [sent, capped, junk]) {
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
  });
});
