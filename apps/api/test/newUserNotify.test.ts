// New-member notifications are each admin's own choice (migration 0026).
//
// The fake D1 below EVALUATES the recipient query's WHERE clause against a
// small user table rather than returning canned rows, for invariant 22's
// reason: the defects worth catching here are a dropped term — mailing a
// disabled admin, a demoted one, or every admin regardless of what they chose —
// and a fake that ignored the SQL would pass all three.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyNewUser, sendNewUserDigest } from "../src/lib/notify.js";
import { settings } from "../src/routes/settings.js";
import type { AuditDraft } from "../src/lib/audit.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

interface UserRow {
  id: string;
  email: string;
  is_system_admin: number;
  disabled_at: string | null;
  new_user_notify: string;
  joined_via: string;
  created_at: string;
}

const ADMINS: UserRow[] = [
  { id: "01A", email: "instant@x.org", is_system_admin: 1, disabled_at: null, new_user_notify: "instant", joined_via: "admin", created_at: "2026-01-01T00:00:00.000Z" },
  { id: "01B", email: "daily@x.org", is_system_admin: 1, disabled_at: null, new_user_notify: "daily", joined_via: "admin", created_at: "2026-01-01T00:00:00.000Z" },
  { id: "01C", email: "off@x.org", is_system_admin: 1, disabled_at: null, new_user_notify: "off", joined_via: "admin", created_at: "2026-01-01T00:00:00.000Z" },
  { id: "01D", email: "disabled@x.org", is_system_admin: 1, disabled_at: "2026-02-01T00:00:00.000Z", new_user_notify: "instant", joined_via: "admin", created_at: "2026-01-01T00:00:00.000Z" },
  { id: "01E", email: "demoted@x.org", is_system_admin: 0, disabled_at: null, new_user_notify: "instant", joined_via: "admin", created_at: "2026-01-01T00:00:00.000Z" },
];

function testEnv(users: UserRow[], settingsRows: Map<string, string> = new Map()): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM setting")) {
        const v = settingsRows.get(this.args[0] as string);
        return v === undefined ? null : { value: v };
      }
      if (sql.includes("SELECT new_user_notify FROM user WHERE id = ?")) {
        const u = users.find((x) => x.id === this.args[0]);
        return u ? { new_user_notify: u.new_user_notify } : null;
      }
      return null;
    },
    async all() {
      if (sql.includes("new_user_notify = ?")) {
        // Evaluate each term only if the statement actually carries it.
        const results = users.filter(
          (u) =>
            u.new_user_notify === this.args[0] &&
            (!sql.includes("is_system_admin = 1") || u.is_system_admin === 1) &&
            (!sql.includes("disabled_at IS NULL") || u.disabled_at === null),
        );
        return { results: results.map((u) => ({ email: u.email })) };
      }
      if (sql.includes("WHERE created_at > ? AND created_at <= ?")) {
        const [since, now] = this.args as string[];
        return {
          results: users
            .filter((u) => u.created_at > since! && u.created_at <= now! && ["signup", "invite"].includes(u.joined_via))
            .map((u) => ({ email: u.email, joined_via: u.joined_via, created_at: u.created_at })),
        };
      }
      return { results: [] };
    },
    async run() {
      if (sql.startsWith("UPDATE user SET new_user_notify")) {
        const u = users.find((x) => x.id === this.args[1]);
        if (u) u.new_user_notify = this.args[0] as string;
      } else if (sql.includes("INSERT INTO setting")) {
        settingsRows.set(this.args[0] as string, this.args[1] as string);
      }
      return { meta: { changes: 1 } };
    },
  });
  return {
    DB: { prepare: (sql: string) => mk(sql) },
    SCHOOL_NAME: "Eisenhower",
    APP_URL: "https://directory.example",
    BOOTSTRAP_ADMIN_EMAILS: "bootstrap@x.org",
  } as unknown as HonoEnv["Bindings"];
}

let sentTo: string[] = [];
beforeEach(() => {
  sentTo = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    const m = /\[email:dev\] to=(\S+)/.exec(String(line));
    if (m) sentTo.push(m[1]!);
  });
});
afterEach(() => vi.restoreAllMocks());

const fresh = () => ADMINS.map((u) => ({ ...u }));

describe("instant notice on a new member", () => {
  it("mails only the enabled admins who chose instant", async () => {
    await notifyNewUser(testEnv(fresh()), { email: "new@family.org", via: "signup", createdAt: "2026-09-24T02:13:57.310Z" });
    expect(sentTo).toEqual(["instant@x.org"]);
  });

  it("does not mail a bootstrap address that has no row — it has made no choice", async () => {
    await notifyNewUser(testEnv(fresh()), { email: "new@family.org", via: "signup", createdAt: "2026-09-24T02:13:57.310Z" });
    expect(sentTo).not.toContain("bootstrap@x.org");
  });

  it("never tells an admin about their own arrival", async () => {
    await notifyNewUser(testEnv(fresh()), { email: "instant@x.org", via: "signup", createdAt: "2026-09-24T02:13:57.310Z" });
    expect(sentTo).toEqual([]);
  });
});

describe("daily digest", () => {
  it("mails only the admins who chose daily, and advances the cursor", async () => {
    const users = [
      ...fresh(),
      { id: "01N", email: "new@family.org", is_system_admin: 0, disabled_at: null, new_user_notify: "off", joined_via: "signup", created_at: new Date(Date.now() - 3600_000).toISOString() },
    ];
    const cursor = new Map([["new_user_digest_since", new Date(Date.now() - 86400_000).toISOString()]]);
    await sendNewUserDigest(testEnv(users, cursor));
    expect(sentTo).toEqual(["daily@x.org"]);
    expect(Date.parse(cursor.get("new_user_digest_since")!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("advances the cursor even when no admin wants the digest", async () => {
    const users = fresh().map((u) => ({ ...u, new_user_notify: "off" }));
    const old = new Date(Date.now() - 20 * 86400_000).toISOString();
    const cursor = new Map([["new_user_digest_since", old]]);
    await sendNewUserDigest(testEnv(users, cursor));
    expect(sentTo).toEqual([]);
    expect(cursor.get("new_user_digest_since")).not.toBe(old);
  });
});

describe("/settings/notifications is the caller's own", () => {
  function appWith(auth: AuthContext, env: HonoEnv["Bindings"], drafts: AuditDraft[]) {
    const app = new Hono<HonoEnv>();
    app.use(
      "*",
      createMiddleware<HonoEnv>(async (c, next) => {
        c.set("audit", drafts);
        c.set("auth", auth);
        await next();
      }),
    );
    app.route("/settings", settings);
    return { req: (path: string, init?: RequestInit) => app.request(path, init, env) };
  }
  const as = (id: string, isSystemAdmin = true): AuthContext => ({
    userId: id, realUserId: id, email: `${id}@x.org`, isSystemAdmin,
    sessionId: "s", activePersonId: null, isMasquerading: false,
  });

  it("reads and writes only the caller's row", async () => {
    const users = fresh();
    const drafts: AuditDraft[] = [];
    const { req } = appWith(as("01C"), testEnv(users), drafts);

    expect(await (await req("/settings/notifications")).json()).toEqual({ newUser: "off" });
    const res = await req("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newUser: "instant" }),
    });
    expect(res.status).toBe(200);
    expect(users.find((u) => u.id === "01C")!.new_user_notify).toBe("instant");
    // Nobody else's choice moved.
    expect(users.filter((u) => u.id !== "01C").map((u) => u.new_user_notify)).toEqual(
      ADMINS.filter((u) => u.id !== "01C").map((u) => u.new_user_notify),
    );
    expect(drafts).toEqual([
      expect.objectContaining({ action: "notify.toggled", entityKind: "user", entityId: "01C" }),
    ]);
  });

  it("refuses a non-admin, which includes an admin masquerading as a member", async () => {
    const { req } = appWith(as("01E", false), testEnv(fresh()), []);
    const res = await req("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newUser: "instant" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects an unknown mode", async () => {
    const { req } = appWith(as("01C"), testEnv(fresh()), []);
    const res = await req("/settings/notifications", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newUser: "hourly" }),
    });
    expect(res.status).toBe(400);
  });
});
