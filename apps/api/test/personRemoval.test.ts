// DELETE /persons/:id — the one destructive act an ordinary member may perform.
//
// Three things are pinned here, and each of them is a way this route could be
// wrong while looking right:
//
//   The AUTHORITY test is sole control, not authorship. `control` is
//   many-to-many by design (two parents, one child), so a Person another User
//   also controls is not this user's to take — invariant 17's rule for User
//   deletion, one level down. A `granted_by = me` reading would have been the
//   obvious spelling and is wrong in both directions.
//
//   The CASCADE order is children-before-parent, and it includes the two rows
//   nobody thinks of: an unconsumed `auth_token` pointing at the deleted Person
//   is a live capability aimed at nothing, and `/auth/callback` would happily
//   create a user for it. `sheetCascade` (invariant 13) is the same shape for
//   the same reason.
//
//   `audit_log` is NEVER touched, and the row carries the NAME. In a second
//   nothing else in the system will hold it, and a record saying a ULID was
//   deleted is not a record of anything.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { persons } from "../src/routes/persons.js";
import type { AuditDraft } from "../src/lib/audit.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

interface Captured {
  sql: string;
  args: unknown[];
}

interface World {
  /** Users other than the caller who also control the target. */
  otherControllers: number;
  /** Households the target solely administers that keep other members. */
  orphanAdminHouseholds: number;
  /** Households the target is the last member of. */
  emptiedHouseholds: string[];
  contactItems: number;
  groups: number;
  volunteerSignups: number;
  /** False to simulate the enumeration gate hiding the row (or it not existing). */
  personVisible: boolean;
}

const WORLD: World = {
  otherControllers: 0,
  orphanAdminHouseholds: 0,
  emptiedHouseholds: [],
  contactItems: 3,
  groups: 2,
  volunteerSignups: 1,
  personVisible: true,
};

function world(over: Partial<World> = {}): World {
  return { ...WORLD, ...over };
}

/** D1 stand-in that answers the impact counts by matching on the SQL, and
 *  records every statement handed to `batch()` in order. */
function testEnv(w: World, captured: Captured[], deletes: string[] = []): HonoEnv["Bindings"] {
  const stmt = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM control WHERE person_id") && sql.includes("user_id <>")) {
        return { n: w.otherControllers };
      }
      if (sql.includes("FROM contact_item")) return { n: w.contactItems };
      if (sql.includes("FROM membership WHERE person_id")) return { n: w.groups };
      if (sql.includes("FROM volunteer_signup")) return { n: w.volunteerSignups };
      // The two household shapes differ by the second EXISTS: the "still has
      // other members" one is the refusal, the other is the emptied count.
      if (sql.includes("mine.is_admin = 1")) return { n: w.orphanAdminHouseholds };
      if (sql.includes("FROM membership mine")) return { n: w.emptiedHouseholds.length };
      if (sql.includes("FROM person p")) {
        return w.personVisible
          ? { first_name: "Milo", last_name: "Ruiz", photo_object_key: null }
          : null;
      }
      return null;
    },
    async all() {
      return { results: w.emptiedHouseholds.map((id) => ({ id })) };
    },
  });
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(stmts: Captured[]) {
        captured.push(...stmts.map((s) => ({ sql: s.sql, args: s.args })));
        deletes.push(...stmts.map((s) => s.sql));
        return [];
      },
    },
    PHOTOS: { async delete() {} },
  } as unknown as HonoEnv["Bindings"];
}

const AUTH: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "dana@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01SELF",
  isMasquerading: false,
};

let audit: AuditDraft[] = [];

function app(controls = true): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      audit = [];
      c.set("audit", audit);
      c.set("auth", AUTH);
      await next();
    }),
  );
  // `isController` reads `control` through the same DB; the fake above answers
  // its shape here so the gate can be flipped per test.
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    const real = c.env.DB.prepare.bind(c.env.DB);
    (c.env as { DB: unknown }).DB = {
      ...c.env.DB,
      prepare: (sql: string) => {
        if (sql.includes("FROM control WHERE user_id = ? AND person_id")) {
          return { bind: () => ({ first: async () => (controls ? { ok: 1 } : null) }) };
        }
        return real(sql);
      },
      batch: c.env.DB.batch.bind(c.env.DB),
    };
    await next();
  }));
  a.route("/persons", persons);
  return a;
}

async function del(w: World, opts: { controls?: boolean } = {}) {
  const captured: Captured[] = [];
  const res = await app(opts.controls ?? true).request(
    "/persons/01MILO",
    { method: "DELETE" },
    testEnv(w, captured),
  );
  return { res, captured, body: await res.json().catch(() => null) };
}

describe("DELETE /persons/:id", () => {
  it("refuses a Person somebody else also controls", async () => {
    const { res, body, captured } = await del(world({ otherControllers: 1 }));
    expect(res.status).toBe(409);
    expect((body as { error: string }).error).toBe("shared");
    // And nothing was removed on the way to saying so.
    expect(captured).toHaveLength(0);
  });

  it("refuses when they solely manage a household that keeps other members", async () => {
    const { res, body } = await del(world({ orphanAdminHouseholds: 1 }));
    expect(res.status).toBe(409);
    expect((body as { error: string }).error).toBe("household_admin");
  });

  it("refuses a caller who does not control them at all", async () => {
    const { res, captured } = await del(world(), { controls: false });
    expect(res.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  it("404s when the enumeration gate hides the row", async () => {
    // Not reachable through the UI — the isController gate admits exactly the
    // audience `personListableSql` does — but the guard must not be decorative.
    const { res, captured } = await del(world({ personVisible: false }));
    expect(res.status).toBe(404);
    expect(captured).toHaveLength(0);
  });

  it("removes every dependent row before the Person, and the Person last", async () => {
    const { res, captured } = await del(world());
    expect(res.status).toBe(200);

    const tables = captured.map((s) => /DELETE FROM (\w+)/.exec(s.sql)?.[1]);
    // Everything that hangs off a Person, and nothing that belongs to the school.
    expect(tables).toEqual([
      "volunteer_signup",
      "share",
      "contact_item",
      "capability_grant",
      "membership",
      "control",
      "control_invite",
      "auth_token",
      "person",
    ]);
    // The one nobody thinks of: an unconsumed invite is a live capability, and
    // /auth/callback creates a user for any non-signin kind.
    expect(tables).toContain("auth_token");
    // Groups are the school's, not the family's.
    expect(tables).not.toContain("grp");
    // Append-only and hash-chained (invariant 5) — never swept, never cascaded.
    expect(tables).not.toContain("audit_log");
  });

  it("takes a household it leaves empty, and only such a household", async () => {
    const { captured } = await del(world({ emptiedHouseholds: ["01HOME"] }));
    const grpDeletes = captured.filter((s) => s.sql.startsWith("DELETE FROM grp"));
    expect(grpDeletes).toHaveLength(1);
    expect(grpDeletes[0]!.args).toEqual(["01HOME"]);
    // Its own contacts go with it — a household's cascading address outlives
    // nothing.
    expect(captured.some((s) => s.sql.includes("owner_kind = 'group'"))).toBe(true);
  });

  it("records the name and the counts, because nothing else will hold them", async () => {
    await del(world({ emptiedHouseholds: ["01HOME"] }));
    const row = audit.find((d) => d.action === "person.deleted");
    expect(row).toBeDefined();
    expect(row!.entityId).toBe("01MILO");
    expect(row!.detail).toMatchObject({
      firstName: "Milo",
      lastName: "Ruiz",
      contactItems: 3,
      groups: 2,
      volunteerSignups: 1,
      emptiedHouseholds: ["01HOME"],
    });
  });

  it("says nothing to Slack — the name could only be forwarded ungated", async () => {
    // invariant 22: a formatter must resolve a name through `personLabel`, and
    // the row it would look up is gone by the time the flush runs. `notify`
    // absent is what keeps `person.deleted` out of the channel entirely.
    await del(world());
    const row = audit.find((d) => d.action === "person.deleted");
    expect(row!.notify).toBeUndefined();
  });
});
