// The invite door's budget (routes/controllers.ts).
//
// POST /persons/:id/controllers used to be the one member-reachable send path
// with no cap at all: /auth/start is budgeted per address and instance-wide,
// the newsletter subscribe and lost&found claim forms are budgeted, but any
// account controlling a Person could mail arbitrary addresses — each send also
// minting a live account-creating invite token — in an unbounded loop. These
// tests pin the two windows, the authenticated-caller 429 (no oracle needed:
// the caller is told about their own quota), the admin exemption, and that the
// count deliberately excludes admin-origin invite rows so a bulk import can't
// lock families out of inviting partners.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { controllers } from "../src/routes/controllers.js";
import type { HonoEnv } from "../src/env.js";

interface Row {
  sql: string;
  args: unknown[];
}

interface Opts {
  /** Rows the rolling-day budget query reports. */
  sentToday?: { total: number; mine: number };
  isSystemAdmin?: boolean;
}

function testEnv(writes: Row[], opts: Opts = {}): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM control ")) return { ok: 1 }; // caller controls the Person
      if (sql.includes("FROM auth_token") && sql.includes("COUNT(*)")) {
        return { total: opts.sentToday?.total ?? 0, mine: opts.sentToday?.mine ?? 0 };
      }
      if (sql.includes("FROM person")) return { first_name: "Milo", last_name: "R." };
      if (sql.includes("FROM user")) return { email: "inviter@example.com" };
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
    SCHOOL_NAME: "Eisenhower PTO",
    DB: {
      prepare: (sql: string) => mk(sql),
      async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
        for (const s of stmts) writes.push({ sql: s.sql, args: s.args });
        return [];
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function app(opts: Opts = {}): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", async (c, next) => {
    c.set("audit", []);
    c.set("auth", {
      userId: "01USER",
      realUserId: "01USER",
      email: "inviter@example.com",
      isSystemAdmin: opts.isSystemAdmin ?? false,
      sessionId: "01SESSION",
      activePersonId: null,
      isMasquerading: false,
      isApproved: true,
    } as never);
    await next();
  });
  a.route("/", controllers);
  return a;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const invite = (env: HonoEnv["Bindings"], opts: Opts = {}) =>
  app(opts).request(
    "/persons/01PERSON/controllers",
    {
      method: "POST",
      body: JSON.stringify({ email: "partner@example.com" }),
      headers: { "Content-Type": "application/json" },
    },
    env,
    ctx,
  );

const wrote = (writes: Row[], fragment: string) => writes.some((w) => w.sql.includes(fragment));

describe("POST /persons/:id/controllers is budgeted", () => {
  it("sends under both caps — invite row and auth_token minted", async () => {
    const writes: Row[] = [];
    const res = await invite(testEnv(writes, { sentToday: { total: 10, mine: 3 } }));
    expect(res.status).toBe(201);
    expect(wrote(writes, "INSERT INTO control_invite")).toBe(true);
    expect(wrote(writes, "INSERT INTO auth_token")).toBe(true);
  });

  it("refuses the 21st send from one account, loudly (429, no row written)", async () => {
    const writes: Row[] = [];
    const res = await invite(testEnv(writes, { sentToday: { total: 30, mine: 20 } }));
    expect(res.status).toBe(429);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invite_limit" });
    // No row means the refusal can't be replayed into growing the table.
    expect(writes).toEqual([]);
  });

  it("refuses everything once the instance-wide ceiling is hit", async () => {
    const writes: Row[] = [];
    const res = await invite(testEnv(writes, { sentToday: { total: 150, mine: 0 } }));
    expect(res.status).toBe(429);
    expect(writes).toEqual([]);
  });

  it("a system admin is exempt — the budget query never runs", async () => {
    const writes: Row[] = [];
    const queried: string[] = [];
    const env = testEnv(writes, { sentToday: { total: 999, mine: 999 } });
    const db = (env as unknown as { DB: { prepare: (sql: string) => unknown } }).DB;
    const original = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      queried.push(sql);
      return original(sql);
    };
    const res = await invite(env, { isSystemAdmin: true });
    expect(res.status).toBe(201);
    expect(queried.some((s) => s.includes("COUNT(*)") && s.includes("auth_token"))).toBe(false);
  });

  it("counts only member-origin invites — admin rows (bulk import) must not spend the window", async () => {
    // Behaviour lives in the WHERE; the fake can't evaluate it, so pin the
    // clause itself: the count must exclude rows whose inviter is an admin.
    const queried: string[] = [];
    const env = testEnv([], { sentToday: { total: 0, mine: 0 } });
    const db = (env as unknown as { DB: { prepare: (sql: string) => unknown } }).DB;
    const original = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      queried.push(sql);
      return original(sql);
    };
    await invite(env);
    const count = queried.find((s) => s.includes("COUNT(*)") && s.includes("auth_token"));
    expect(count).toBeDefined();
    expect(count).toContain("kind = 'invite'");
    expect(count).toContain("is_system_admin = 1");
    expect(count).toContain("NOT IN");
  });
});
