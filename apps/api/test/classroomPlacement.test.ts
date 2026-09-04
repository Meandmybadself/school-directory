// PUT / DELETE /persons/:id/classroom — the one roster an ordinary member may
// edit without administering it.
//
// This route exists because a parent needs to put their own child in a room and
// `POST /groups/:id/members` will not let them: that gate is `requireGroupAdmin`
// — authority over a ROSTER — and most classrooms have no admin at all. The gate
// here is `isController` — authority over a PERSON. Four things are pinned, and
// each is a way this could be wrong while looking right:
//
//   THE MEMBERSHIP IS SELF-ASSERTED (`self_asserted = 1`, migration 0023), and
//   that is the containment. The row puts the child on the roster while
//   `viewerIsDirectMember` and `effectiveGroupIdsForPerson` both skip it, so the
//   placement confers no sight of the room's private contacts, its exact address,
//   or anything other members shared with it. The first draft leaned on the
//   `student` capability plus the one-room cap instead, and both legs were
//   rotten: any member can mint a Person holding `student` (POST /me/persons,
//   ASSIGNABLE_CAPABILITIES), and a cap on SIMULTANEOUS membership bounds
//   nothing when reading is a repeatable GET — walk one Person through all 34
//   rooms one PUT at a time and read each in turn. The literal is asserted here
//   because it is the whole defence.
//
//   ONE ROOM AT A TIME is now a roster-correctness rule, and the delete that
//   enforces it is re-derived INSIDE the batch rather than from the ids read a
//   moment earlier — D1 has no read-then-write transaction, so two concurrent
//   PUTs (two parents, or one parent in two tabs) would otherwise both read an
//   empty set, both delete nothing and both insert.
//
//   AN ADMIN MEMBERSHIP IS NEVER TOUCHED. Both the refusal and the `is_admin = 0`
//   in every DELETE's WHERE are asserted: the guard and the belt, because a
//   route that refuses at the top but writes an unscoped delete is one reordering
//   away from unseating whoever runs a classroom.
//
//   A NO-OP WRITES NO AUDIT ROW. Re-sending the same placement — a double tap, a
//   retry — must not be able to pad an append-only log (invariant 5).

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
  /** The target group, or null to make it not exist. */
  group: { id: string; kind: string; name: string } | null;
  /** Does the Person hold `student`? */
  isStudent: boolean;
  /** Classroom memberships the Person already holds. */
  current: { id: string; name: string; is_admin: number }[];
}

const ROOM_A = { id: "01ROOMA", kind: "classroom", name: "Grade 2 · Juntos · Pam Shrestha · Rm 322" };
const ROOM_B = { id: "01ROOMB", kind: "classroom", name: "Grade 2 · XinXing · Lin Niu · Rm 320" };

function world(over: Partial<World> = {}): World {
  return { group: ROOM_A, isStudent: true, current: [], ...over };
}

function testEnv(w: World, captured: Captured[], ran: Captured[] = []): HonoEnv["Bindings"] {
  const stmt = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    // The DELETE route writes one statement directly rather than through a
    // batch, so `.run()` is captured separately from `batch()`.
    async run() {
      ran.push({ sql: this.sql, args: this.args });
      return { meta: { changes: 1 } };
    },
    async first() {
      if (sql.includes("FROM grp WHERE id")) return w.group;
      if (sql.includes("FROM capability_grant")) return w.isStudent ? { ok: 1 } : null;
      return null;
    },
    async all() {
      if (sql.includes("FROM membership m") && sql.includes("g.kind = 'classroom'")) {
        return { results: w.current };
      }
      return { results: [] };
    },
  });
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(stmts: Captured[]) {
        captured.push(...stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return [];
      },
    },
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
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
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
    }),
  );
  a.route("/persons", persons);
  return a;
}

// `body` is passed as an object rather than a groupId so a test can send `{}`.
// A default parameter cannot express that: passing `undefined` explicitly would
// fall back to the default and quietly test the happy path instead.
async function put(w: World, payload: Record<string, unknown> = { groupId: ROOM_A.id }, opts: { controls?: boolean } = {}) {
  const captured: Captured[] = [];
  const res = await app(opts.controls ?? true).request(
    "/persons/01MILO/classroom",
    { method: "PUT", body: JSON.stringify(payload), headers: { "content-type": "application/json" } },
    testEnv(w, captured),
  );
  return { res, captured, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function del(w: World, groupId: string | null = ROOM_A.id, opts: { controls?: boolean } = {}) {
  const captured: Captured[] = [];
  const ran: Captured[] = [];
  const qs = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
  const res = await app(opts.controls ?? true).request(
    `/persons/01MILO/classroom${qs}`,
    { method: "DELETE" },
    testEnv(w, captured, ran),
  );
  return { res, captured, ran, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const deletes = (captured: Captured[]) => captured.filter((s) => s.sql.startsWith("DELETE"));
const inserts = (captured: Captured[]) => captured.filter((s) => s.sql.includes("INSERT INTO membership"));

describe("PUT /persons/:id/classroom", () => {
  it("refuses a caller who does not control the Person", async () => {
    const { res, captured } = await put(world(), { groupId: ROOM_A.id }, { controls: false });
    expect(res.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  it("refuses a Person without the student capability", async () => {
    const { res, body, captured } = await put(world({ isStudent: false }));
    expect(res.status).toBe(403);
    expect(body?.error).toBe("not_a_student");
    // Nothing was written on the way to saying so.
    expect(captured).toHaveLength(0);
  });

  it("refuses a group that is not a classroom", async () => {
    const { res, body } = await put(world({ group: { id: "01HH", kind: "household", name: "The Ruiz family" } }));
    expect(res.status).toBe(400);
    expect(body?.error).toBe("not_a_classroom");
  });

  it("404s a group that does not exist", async () => {
    const { res } = await put(world({ group: null }));
    expect(res.status).toBe(404);
  });

  it("400s without a groupId", async () => {
    const { res, body } = await put(world(), {});
    expect(res.status).toBe(400);
    expect(body?.error).toBe("invalid_body");
  });

  it("places a child who is in no classroom, as a self-asserted membership", async () => {
    const { res, captured } = await put(world());
    expect(res.status).toBe(200);
    // The delete is unconditional now (it re-derives its own set), so it is
    // present even when there is nothing to remove.
    expect(inserts(captured)).toHaveLength(1);
    // title, is_admin AND self_asserted are literals in the SQL, so no request
    // body can mint an admin, a title, or a trusted membership.
    expect(inserts(captured)[0]!.sql).toContain("VALUES (?,?,NULL,0,1,?)");
    expect(inserts(captured)[0]!.sql).toContain("self_asserted");
  });

  it("MOVES a child already in another room — the old membership is deleted", async () => {
    const w = world({ current: [{ id: ROOM_B.id, name: ROOM_B.name, is_admin: 0 }] });
    const { res, captured, body } = await put(w);
    expect(res.status).toBe(200);
    expect(body?.moved).toBe(true);
    // One room at a time — and the delete is scoped by KIND, evaluated at write
    // time, not by the ids read a moment ago. That is what makes two concurrent
    // PUTs safe; a test asserting an id list would have locked in the race.
    const d = deletes(captured);
    expect(d).toHaveLength(1);
    expect(d[0]!.sql).toContain("SELECT id FROM grp WHERE kind = 'classroom'");
    expect(d[0]!.sql).toContain("group_id <> ?");
    expect(d[0]!.args).toEqual(["01MILO", ROOM_A.id]);
    expect(inserts(captured)).toHaveLength(1);
  });

  it("names the room left behind on the audit row", async () => {
    const w = world({ current: [{ id: ROOM_B.id, name: ROOM_B.name, is_admin: 0 }] });
    await put(w);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("classroom.enrolled");
    // `membership` keeps no history, so this row is the only thing that will
    // remember where they came from.
    expect(audit[0]!.detail).toMatchObject({
      groupId: ROOM_A.id,
      movedFrom: [{ groupId: ROOM_B.id, name: ROOM_B.name }],
    });
  });

  it("is a no-op — no write, no audit row — when they are already there", async () => {
    const w = world({ current: [{ id: ROOM_A.id, name: ROOM_A.name, is_admin: 0 }] });
    const { res, captured, body } = await put(w);
    expect(res.status).toBe(200);
    expect(body?.moved).toBe(false);
    expect(captured).toHaveLength(0);
    // An append-only log must not be paddable by a double tap.
    expect(audit).toHaveLength(0);
  });

  it("refuses to move a Person who ADMINISTERS a classroom", async () => {
    const w = world({ current: [{ id: ROOM_B.id, name: ROOM_B.name, is_admin: 1 }] });
    const { res, body, captured } = await put(w);
    expect(res.status).toBe(409);
    expect(body?.error).toBe("runs_a_classroom");
    expect(captured).toHaveLength(0);
  });

  it("scopes every delete to is_admin = 0", async () => {
    const w = world({ current: [{ id: ROOM_B.id, name: ROOM_B.name, is_admin: 0 }] });
    const { captured } = await put(w);
    // The belt behind the guard above: even reordered, this statement cannot
    // unseat whoever runs a room.
    for (const d of deletes(captured)) expect(d.sql).toContain("is_admin = 0");
  });
});

describe("DELETE /persons/:id/classroom", () => {
  it("refuses a caller who does not control the Person", async () => {
    const { res, ran } = await del(world(), ROOM_A.id, { controls: false });
    expect(res.status).toBe(403);
    expect(ran).toHaveLength(0);
  });

  it("400s without a groupId", async () => {
    const { res, body } = await del(world(), null);
    expect(res.status).toBe(400);
  });

  it("404s when they are not in that classroom", async () => {
    const { res, body } = await del(world());
    expect(res.status).toBe(404);
    expect(body?.error).toBe("not_enrolled");
  });

  it("removes ONLY the named room, leaving the child's other classrooms alone", async () => {
    // A child can hold two: lib/bulkImport.ts defaults groupKind to "classroom",
    // so any group a roster import invents is one. The first draft of this route
    // deleted every classroom membership while the UI said "remove from THIS
    // class" — a parent fixing Room 322 would silently lose Room 320 too.
    const w = world({
      current: [
        { id: ROOM_A.id, name: ROOM_A.name, is_admin: 0 },
        { id: ROOM_B.id, name: ROOM_B.name, is_admin: 0 },
      ],
    });
    const { res, ran } = await del(w, ROOM_A.id);
    expect(res.status).toBe(200);
    expect(ran).toHaveLength(1);
    expect(ran[0]!.args).toEqual(["01MILO", ROOM_A.id]);
    expect(ran[0]!.sql).toContain("is_admin = 0");
    expect(audit[0]!.action).toBe("classroom.unenrolled");
    expect(audit[0]!.detail).toMatchObject({ groupId: ROOM_A.id, groupName: ROOM_A.name });
  });

  it("refuses to remove a Person who ADMINISTERS that classroom", async () => {
    const w = world({ current: [{ id: ROOM_A.id, name: ROOM_A.name, is_admin: 1 }] });
    const { res, body, ran } = await del(w, ROOM_A.id);
    expect(res.status).toBe(409);
    expect(body?.error).toBe("runs_a_classroom");
    expect(ran).toHaveLength(0);
  });
});

// ── The containment, tested where it actually lives ─────────────────────────
//
// The assertions above prove the ROUTE writes `self_asserted = 1`. This proves
// the share rollup honours it; `test/groupMembers.test.ts` proves the group
// detail does, behaviourally, by reading a private contact back. They are
// separate tests on purpose: a flag written and read by nothing is exactly the
// failure invariant 5 describes for `prev_hash` — it has to be checked
// somewhere, or it is decoration.

describe("a self-asserted membership confers no sight", () => {
  it("is excluded from the share rollup", async () => {
    // `effectiveGroupIdsForPerson` feeds `viewerGroupIds`, which is what
    // `canSeeItem` reads to decide whether an item shared WITH a group reaches
    // this viewer. A Controller can switch active Person to the child
    // (POST /me/active-person), so if this set included a room the parent placed
    // the child in themselves, every item shared with that room would be theirs
    // to read — and repeating the PUT walks one Person through every room.
    const seen: string[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => {
          seen.push(sql);
          return {
            bind: () => ({ all: async () => ({ results: [] }) }),
            all: async () => ({ results: [] }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
    const { effectiveGroupIdsForPerson } = await import("../src/lib/groupTree.js");
    await effectiveGroupIdsForPerson(env, "01MILO");
    const membershipRead = seen.find((q) => q.includes("FROM membership WHERE person_id"));
    expect(membershipRead).toBeDefined();
    expect(membershipRead).toContain("self_asserted = 0");
  });

});
