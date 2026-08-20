// Disabling an account, and the dry run that precedes deleting one.
//
// The guards are the whole feature. Disabling is the one admin action that can
// take a working account away from a family, and the impact report is what
// stands between an admin and a delete that removes somebody else's child — so
// the tests below pin the refusals, not the happy path.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { admin } from "../src/routes/admin.js";
import { auth as authRoutes } from "../src/routes/auth.js";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const ADMIN: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: "01ADMINPERSON",
  isMasquerading: false,
};

interface Row {
  sql: string;
  args: unknown[];
}

/** D1 stand-in. `rows` records what the route tried to write. */
function testEnv(
  rows: Row[],
  opts: { target?: Record<string, unknown> | null; lastAdmin?: boolean } = {},
): HonoEnv["Bindings"] {
  const target =
    opts.target === undefined
      ? { id: "01TARGET", email: "parent@example.com", disabled_at: null }
      : opts.target;
  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM user")) return target;
      if (sql.includes("FROM audit_log")) return { n: 7 };
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      rows.push({ sql, args: this.args });
      // The last-admin guard is a WHERE clause, so a refusal shows up as zero
      // rows changed rather than an error — model that faithfully.
      const guarded = sql.includes("is_system_admin = 0");
      return { meta: { changes: guarded && opts.lastAdmin === true ? 0 : 1 } };
    },
  });
  return {
    DB: {
      prepare: (sql: string) => mk(sql),
      async batch(stmts: Row[]) {
        rows.push(...stmts.map((x) => ({ sql: x.sql, args: x.args })));
        return [];
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function appWith(auth: AuthContext | null): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", []);
      if (auth) c.set("auth", auth);
      await next();
    }),
  );
  app.route("/admin", admin);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

function post(
  auth: AuthContext | null,
  id: string,
  body: unknown,
  env?: HonoEnv["Bindings"],
  rows: Row[] = [],
) {
  return appWith(auth).request(
    `/admin/users/${id}/disabled`,
    { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
    env ?? testEnv(rows),
  );
}

describe("disabling an account — the refusals", () => {
  it("401s with no session", async () => {
    const res = await post(null, "01TARGET", { disabled: true });
    expect(res.status).toBe(401);
  });

  it("403s an ordinary member", async () => {
    const res = await post({ ...ADMIN, isSystemAdmin: false }, "01TARGET", { disabled: true });
    expect(res.status).toBe(403);
  });

  it("refuses while masquerading — acting AS someone is not a way to lock them out", async () => {
    const res = await post({ ...ADMIN, isMasquerading: true }, "01TARGET", { disabled: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_while_masquerading" });
  });

  it("refuses to disable yourself — it is the one move that can empty the admin set", async () => {
    const res = await post(ADMIN, ADMIN.userId, { disabled: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_disable_self" });
  });

  it("404s an account that isn't there", async () => {
    const rows: Row[] = [];
    const res = await post(ADMIN, "01GHOST", { disabled: true }, testEnv(rows, { target: null }), rows);
    expect(res.status).toBe(404);
    expect(rows).toEqual([]);
  });

  it("rejects a body that doesn't say which way", async () => {
    const res = await post(ADMIN, "01TARGET", {});
    expect(res.status).toBe(400);
  });
});

describe("disabling an account — what it writes", () => {
  it("stamps disabled_at and ends their sessions, and nothing else", async () => {
    const rows: Row[] = [];
    const res = await post(ADMIN, "01TARGET", { disabled: true }, testEnv(rows), rows);
    expect(res.status).toBe(200);

    const written = rows.map((r) => r.sql.replace(/\s+/g, " ").trim());
    expect(written.some((s) => s.startsWith("UPDATE user SET disabled_at"))).toBe(true);
    expect(written.some((s) => s.startsWith("DELETE FROM session"))).toBe(true);
    // The point of this being reversible: their people, groups, contact items
    // and audit trail are all still there afterwards.
    expect(written.some((s) => /DELETE FROM (person|grp|control|membership|contact_item|audit_log)/.test(s))).toBe(false);
  });

  it("re-enabling clears the stamp and keeps sessions deleted", async () => {
    const rows: Row[] = [];
    const res = await post(
      ADMIN,
      "01TARGET",
      { disabled: false },
      testEnv(rows, { target: { id: "01TARGET", email: "p@example.com", disabled_at: "2026-01-01T00:00:00.000Z" } }),
      rows,
    );
    expect(res.status).toBe(200);
    const written = rows.map((r) => r.sql.replace(/\s+/g, " ").trim());
    expect(written.some((s) => s.startsWith("UPDATE user SET disabled_at"))).toBe(true);
    expect(rows.find((r) => r.sql.includes("UPDATE user"))?.sql).toContain("disabled_at = NULL");
    expect(written.some((s) => s.startsWith("DELETE FROM session"))).toBe(false);
  });

  it("is idempotent — disabling an already-disabled account writes nothing", async () => {
    const rows: Row[] = [];
    const res = await post(
      ADMIN,
      "01TARGET",
      { disabled: true },
      testEnv(rows, { target: { id: "01TARGET", email: "p@example.com", disabled_at: "2026-01-01T00:00:00.000Z" } }),
      rows,
    );
    expect(res.status).toBe(200);
    expect(rows).toEqual([]);
  });
});

describe("the deletion impact report", () => {
  it("writes nothing at all — it is a dry run", async () => {
    const rows: Row[] = [];
    const res = await appWith(ADMIN).request(
      "/admin/users/01TARGET/impact",
      {},
      testEnv(rows),
    );
    expect(res.status).toBe(200);
    expect(rows).toEqual([]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        "auditEntries",
        "emptiedHouseholds",
        "orphanedPersons",
        "retainedGroupsAdministered",
        "sharedPersons",
        "user",
      ].sort(),
    );
    // Always reported, never removed — the log is hash-chained.
    expect(body.auditEntries).toBe(7);
  });

  it("403s an ordinary member", async () => {
    const res = await appWith({ ...ADMIN, isSystemAdmin: false }).request(
      "/admin/users/01TARGET/impact",
      {},
      testEnv([]),
    );
    expect(res.status).toBe(403);
  });
});

// ── The other half of "disabled": the front door ────────────────────────────

describe("a disabled account cannot get a session", () => {
  /** Enough of D1 for GET /auth/callback: a live token, a user who exists, and
   *  a `disabled_at` we can flip. */
  function authEnv(disabledAt: string | null, writes: Row[]): HonoEnv["Bindings"] {
    const mk = (sql: string) => ({
      sql,
      args: [] as unknown[],
      bind(...args: unknown[]) {
        this.args = args;
        return this;
      },
      async first() {
        if (sql.includes("FROM auth_token")) {
          return {
            id: "01TOKEN",
            email: "marcus@example.com",
            kind: "signin",
            person_id: null,
            invited_by: null,
            reg_open_at_issue: 1,
            expires_at: "2099-01-01T00:00:00.000Z",
            consumed_at: null,
            return_to: null,
          };
        }
        if (sql.includes("disabled_at FROM user")) return { disabled_at: disabledAt };
        if (sql.includes("FROM user")) {
          return { id: "01MARCUS", email: "marcus@example.com", is_system_admin: 0, locale: null };
        }
        if (sql.includes("FROM setting")) return { value: "true" };
        return null;
      },
      async all() {
        return { results: [] };
      },
      async run() {
        writes.push({ sql, args: this.args });
        return { meta: { changes: 1 } };
      },
    });
    return {
      APP_URL: "http://localhost:5173",
      ALLOWED_ORIGINS: "http://localhost:5173",
      SCHOOL_NAME: "Eisenhower PTO",
      DB: { prepare: (sql: string) => mk(sql), async batch() { return []; } },
    } as unknown as HonoEnv["Bindings"];
  }

  const callback = (env: HonoEnv["Bindings"]) => {
    const app = new Hono<HonoEnv>();
    app.use("*", createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", []);
      await next();
    }));
    app.route("/auth", authRoutes);
    return app.request("/auth/callback?t=sometoken", {}, env, {
      waitUntil() {},
      passThroughOnException() {},
    } as unknown as ExecutionContext);
  };

  it("turns the magic link away, and mints no session", async () => {
    const writes: Row[] = [];
    const res = await callback(authEnv("2026-01-01T00:00:00.000Z", writes));
    expect(res.status).toBe(302);
    // The same destination an expired link gets: nothing here may reveal that
    // the address exists but is switched off (invariant 4).
    expect(res.headers.get("location")).toBe("http://localhost:5173/sign-in?error=link");
    expect(writes.some((w) => w.sql.includes("INSERT INTO session"))).toBe(false);
  });

  it("still lets an active account through", async () => {
    const writes: Row[] = [];
    const res = await callback(authEnv(null, writes));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).not.toContain("error=link");
    expect(writes.some((w) => w.sql.includes("INSERT INTO session"))).toBe(true);
  });
});

// ── Guards added after review ───────────────────────────────────────────────

describe("disabling can never empty the admin set", () => {
  it("refuses when no other enabled admin would be left", async () => {
    const rows: Row[] = [];
    const res = await post(ADMIN, "01OTHERADMIN", { disabled: true }, testEnv(rows, { lastAdmin: true }), rows);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("last_admin");
    // Refused means refused — their sessions are left alone.
    expect(rows.some((r) => r.sql.includes("DELETE FROM session"))).toBe(false);
  });

  it("puts the count inside the UPDATE, not in a read before it", async () => {
    // D1 has no transaction across read-then-write, so a SELECT-then-UPDATE
    // would let two admins disable each other in overlapping requests and leave
    // nobody able to sign in. SQLite serializes the writes; the loser matches
    // no rows.
    const rows: Row[] = [];
    await post(ADMIN, "01OTHERADMIN", { disabled: true }, testEnv(rows), rows);
    const update = rows.find((r) => r.sql.includes("UPDATE user SET disabled_at"));
    expect(update?.sql).toContain("is_system_admin = 0");
    expect(update?.sql).toContain("other.disabled_at IS NULL");
  });
});

describe("disabling ends a masquerade the account was driving", () => {
  it("matches acting_admin_id as well as user_id", async () => {
    // A masquerade session's user_id is the person being impersonated, so
    // matching on user_id alone would leave a disabled admin acting as somebody
    // else until the masquerade expired an hour later.
    const rows: Row[] = [];
    await post(ADMIN, "01TARGET", { disabled: true }, testEnv(rows), rows);
    const del = rows.find((r) => r.sql.includes("DELETE FROM session"));
    expect(del?.sql).toContain("acting_admin_id");
    expect(del?.args).toEqual(["01TARGET", "01TARGET"]);
  });
});
