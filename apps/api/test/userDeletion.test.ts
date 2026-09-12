// DELETE /admin/users/:id — permanent account deletion (invariant 17).
//
// The guards are the feature, because the act is irreversible and the obvious
// reading is wrong. Pinned here:
//
//   AUTHORITY + FRICTION: system admin only, never while masquerading, never
//   yourself, and only once the account is already DISABLED (the reversible step
//   first). The last-admin case needs no separate guard — a deletable account is
//   disabled, and the last enabled admin can't be disabled.
//
//   The CASCADE executes the impact report, not a guess. A sole-controlled
//   Person is removed with its full cascade; a co-controlled one is KEPT and
//   loses only this account's control. Emptied households go. Account-owned rows
//   nothing else holds (volunteer claims, board comments, sessions, sign-in
//   tokens) are deleted; records that merely attribute something to the account
//   are NULLed, not dropped. The `user` row is last.
//
//   `audit_log` is NEVER touched (invariant 5), and the Slack `notify` bag
//   carries the email only — no name, no counts (invariant 22).

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { admin } from "../src/routes/admin.js";
import type { AuditDraft } from "../src/lib/audit.js";
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

interface World {
  /** null models a user that isn't there. */
  target?: { id: string; email: string; disabled_at: string | null } | null;
  /** Persons this account controls, with how many OTHERS also control each. */
  people?: { id: string; first_name: string; last_name: string | null; others: number }[];
  /** Households the orphans would empty. */
  emptied?: { id: string; name: string }[];
  auditEntries?: number;
  volunteerClaims?: number;
  boardComments?: number;
}

/** D1 stand-in. `rows` records every write (run + batch); reads are answered
 *  from `world` by matching on the SQL. */
function testEnv(rows: Row[], world: World = {}): HonoEnv["Bindings"] {
  const target =
    world.target === undefined
      ? { id: "01TARGET", email: "parent@example.com", disabled_at: "2026-01-01T00:00:00.000Z" }
      : world.target;
  const people = world.people ?? [];
  const emptied = world.emptied ?? [];

  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM user")) return target;
      if (sql.includes("FROM audit_log")) return { n: world.auditEntries ?? 0 };
      if (sql.includes("FROM volunteer_signup")) return { n: world.volunteerClaims ?? 0 };
      if (sql.includes("FROM pto_card_comment")) return { n: world.boardComments ?? 0 };
      return null;
    },
    async all() {
      if (sql.includes("JOIN person p ON p.id = c.person_id")) return { results: people };
      if (sql.includes("FROM grp") && sql.includes("kind = 'household'")) return { results: emptied };
      return { results: [] }; // retained groups, etc.
    },
    async run() {
      rows.push({ sql, args: this.args });
      return { meta: { changes: 1 } };
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

function appWith(auth: AuthContext | null, audit: AuditDraft[] = []): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", audit);
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

function del(
  auth: AuthContext | null,
  id: string,
  env?: HonoEnv["Bindings"],
  rows: Row[] = [],
  audit: AuditDraft[] = [],
) {
  return appWith(auth, audit).request(
    `/admin/users/${id}`,
    { method: "DELETE" },
    env ?? testEnv(rows),
  );
}

const norm = (rows: Row[]) => rows.map((r) => r.sql.replace(/\s+/g, " ").trim());

describe("permanent user deletion — the refusals", () => {
  it("401s with no session", async () => {
    expect((await del(null, "01TARGET")).status).toBe(401);
  });

  it("403s an ordinary member", async () => {
    expect((await del({ ...ADMIN, isSystemAdmin: false }, "01TARGET")).status).toBe(403);
  });

  it("refuses while masquerading", async () => {
    const res = await del({ ...ADMIN, isMasquerading: true }, "01TARGET");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_while_masquerading" });
  });

  it("refuses to delete yourself", async () => {
    const res = await del(ADMIN, ADMIN.userId);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "cannot_delete_self" });
  });

  it("404s an account that isn't there, writing nothing", async () => {
    const rows: Row[] = [];
    const res = await del(ADMIN, "01GHOST", testEnv(rows, { target: null }), rows);
    expect(res.status).toBe(404);
    expect(rows).toEqual([]);
  });

  it("refuses an account that is still enabled — disable first", async () => {
    const rows: Row[] = [];
    const res = await del(
      ADMIN,
      "01TARGET",
      testEnv(rows, { target: { id: "01TARGET", email: "p@example.com", disabled_at: null } }),
      rows,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("not_disabled");
    // Refused means refused: not a single write.
    expect(rows).toEqual([]);
  });
});

describe("permanent user deletion — what it executes", () => {
  const world: World = {
    target: { id: "01TARGET", email: "parent@example.com", disabled_at: "2026-01-01T00:00:00.000Z" },
    people: [
      { id: "01ORPHAN", first_name: "Milo", last_name: "Ruiz", others: 0 },
      { id: "01SHARED", first_name: "Ada", last_name: "Ruiz", others: 1 },
    ],
    emptied: [{ id: "01HOUSE", name: "Ruiz household" }],
    auditEntries: 5,
    volunteerClaims: 2,
    boardComments: 1,
  };

  it("removes the orphan, keeps the co-controlled Person, and empties the household", async () => {
    const rows: Row[] = [];
    const res = await del(ADMIN, "01TARGET", testEnv(rows, world), rows);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Orphan gets the full person cascade; its row is deleted.
    const personDeletes = rows.filter((r) => /DELETE FROM person WHERE id = \?/.test(r.sql.replace(/\s+/g, " ")));
    expect(personDeletes.map((r) => r.args[0])).toEqual(["01ORPHAN"]);
    // The co-controlled Person is NOT deleted…
    expect(rows.some((r) => r.sql.includes("DELETE FROM person") && r.args[0] === "01SHARED")).toBe(false);
    // …only this account's control of them is dropped.
    const dropControl = rows.find((r) => /DELETE FROM control WHERE user_id = \?/.test(r.sql.replace(/\s+/g, " ")));
    expect(dropControl?.args).toEqual(["01TARGET"]);
    // The emptied household is removed.
    expect(rows.some((r) => r.sql.includes("DELETE FROM grp") && r.args[0] === "01HOUSE")).toBe(true);
  });

  it("deletes the account-owned rows nothing else holds", async () => {
    const rows: Row[] = [];
    await del(ADMIN, "01TARGET", testEnv(rows, world), rows);
    const written = norm(rows);
    expect(written.some((s) => s.startsWith("DELETE FROM volunteer_signup WHERE user_id"))).toBe(true);
    expect(written.some((s) => s.startsWith("DELETE FROM pto_card_comment WHERE author_user_id"))).toBe(true);
    const session = rows.find((r) => r.sql.includes("DELETE FROM session"));
    expect(session?.sql).toContain("acting_admin_id");
    expect(session?.args).toEqual(["01TARGET", "01TARGET"]);
    // Sign-in tokens are keyed by the account's email, not its id.
    const tokens = rows.find((r) => r.sql.includes("DELETE FROM auth_token WHERE email"));
    expect(tokens?.args).toEqual(["parent@example.com"]);
  });

  it("NULLs attributions rather than deleting the records that carry them", async () => {
    const rows: Row[] = [];
    await del(ADMIN, "01TARGET", testEnv(rows, world), rows);
    const written = norm(rows);
    for (const s of [
      "UPDATE store_order SET user_id = NULL WHERE user_id = ?",
      "UPDATE pto_card SET created_by = NULL WHERE created_by = ?",
      "UPDATE managed_event SET created_by = NULL WHERE created_by = ?",
      "UPDATE control SET granted_by = NULL WHERE granted_by = ?",
    ]) {
      expect(written).toContain(s);
    }
    // The order/board rows themselves are never deleted.
    expect(written.some((s) => s.startsWith("DELETE FROM store_order"))).toBe(false);
    expect(written.some((s) => s.startsWith("DELETE FROM pto_card "))).toBe(false);
  });

  it("deletes the user row LAST and never touches audit_log", async () => {
    const rows: Row[] = [];
    await del(ADMIN, "01TARGET", testEnv(rows, world), rows);
    const written = norm(rows);
    expect(written[written.length - 1]).toBe("DELETE FROM user WHERE id = ?");
    expect(written.some((s) => /audit_log/.test(s))).toBe(false);
  });

  it("audits with counts in detail, but only op+email in notify (invariant 22)", async () => {
    const rows: Row[] = [];
    const audit: AuditDraft[] = [];
    await del(ADMIN, "01TARGET", testEnv(rows, world), rows, audit);
    const draft = audit.find((d) => (d.detail as { op?: string })?.op === "user.deleted");
    expect(draft).toBeTruthy();
    expect(draft?.action).toBe("admin.action");
    // Slack bag: the email only — no name, no counts leave for the channel.
    expect(draft?.notify).toEqual({ op: "user.deleted", email: "parent@example.com" });
    expect(Object.keys(draft?.notify ?? {})).not.toContain("orphanedPersons");
  });
});
