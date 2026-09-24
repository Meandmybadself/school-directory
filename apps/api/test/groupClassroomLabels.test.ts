// GET /groups/:id — the classroom label on a HOUSEHOLD's roster.
//
// A household's roster is three first names until something says which child is
// which, so its rows now carry the room. Two properties are worth pinning, and
// neither is visible in the other group tests: they fix `kind: "classroom"`, so
// the household branch never runs there at all.
//
// The fake evaluates `g.kind = 'classroom'` rather than assuming it — the same
// bargain profileHouseholds.test.ts makes — so a read that dropped the term
// fails with the HOUSEHOLD's own name on every row instead of passing a scan.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { groups } from "../src/routes/groups.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

const GROUP_ID = "01GROUP";
const MILO = "01MILO";
const DANA = "01DANA";

const VIEWER: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "parent@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: DANA,
  isMasquerading: false,
  isApproved: true,
};

/** Who is a student. Dana is a parent, and sits on the SAME classroom roster
 *  Milo does — a room parent, or the teacher of it. */
const CAPABILITIES = [{ person_id: MILO, capability: "student" }, { person_id: DANA, capability: "parent" }];

/** The household is in this table too, so a read that forgot `g.kind` has
 *  something wrong to return — and so is Dana's classroom row, so a read that
 *  forgot `student` does. */
const MEMBERSHIPS = [
  { person_id: MILO, group_id: "01ROOM", group_name: "Grade 2 · Juntos · Pam Shrestha · Rm 322", kind: "classroom" },
  { person_id: DANA, group_id: "01ROOM", group_name: "Grade 2 · Juntos · Pam Shrestha · Rm 322", kind: "classroom" },
  { person_id: MILO, group_id: GROUP_ID, group_name: "The Ruiz Household", kind: "household" },
  { person_id: DANA, group_id: GROUP_ID, group_name: "The Ruiz Household", kind: "household" },
];

interface Seen {
  sql: string;
}

function testEnv(kind: string, seen: Seen[]): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      if (sql.includes("FROM grp WHERE id = ?")) {
        return { id: GROUP_ID, kind, name: "The Ruiz Household", parent_id: null, ok: 1 };
      }
      if (sql.includes("JOIN control ctl")) return null;
      if (sql.includes("SELECT is_admin FROM membership")) return { is_admin: 0 };
      return null;
    },
    async all() {
      seen.push({ sql });
      if (sql.includes("SELECT id, parent_id FROM grp")) {
        return { results: [{ id: GROUP_ID, parent_id: null }] };
      }
      if (sql.includes("JOIN person p ON p.id = m.person_id")) {
        return {
          results: [MILO, DANA].map((id) => ({
            person_id: id,
            title: null,
            is_admin: 0,
            is_direct: 1,
            self_asserted: 0,
            first_name: id === MILO ? "Milo" : "Dana",
            last_name: "Ruiz",
            last_name_visibility: "full",
            photo_object_key: null,
          })),
        };
      }
      if (sql.includes("FROM control WHERE user_id = ?")) return { results: [{ person_id: DANA }] };
      // The classroom label. The kind term is honoured, not assumed.
      if (sql.includes("FROM membership m JOIN grp g")) {
        const ids = this.args.map(String);
        return {
          results: MEMBERSHIPS.filter((m) => ids.includes(m.person_id))
            .filter((m) => (sql.includes("'classroom'") ? m.kind === "classroom" : true))
            // The `student` clause, honoured rather than assumed.
            .filter((m) => (sql.includes("capability = 'student'")
              ? CAPABILITIES.some((c) => c.person_id === m.person_id && c.capability === "student")
              : true))
            .map((m) => ({ person_id: m.person_id, id: m.group_id, name: m.group_name })),
        };
      }
      return { results: [] };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

interface Member {
  personId: string;
  classrooms?: { id: string; name: string }[];
}

async function roster(kind: string): Promise<{ members: Member[]; seen: Seen[] }> {
  const seen: Seen[] = [];
  const app = new Hono<HonoEnv>();
  app.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    c.set("auth", VIEWER);
    await next();
  }));
  app.route("/groups", groups);
  const res = await app.request(`/groups/${GROUP_ID}`, {}, testEnv(kind, seen));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { members: Member[] };
  return { members: body.members, seen };
}

const roomRead = (seen: Seen[]) => seen.filter((s) => s.sql.includes("FROM membership m JOIN grp g"));

describe("GET /groups/:id classroom labels", () => {
  it("labels a household's roster with each member's room", async () => {
    const { members } = await roster("household");
    const milo = members.find((m) => m.personId === MILO);
    expect(milo?.classrooms).toEqual([
      { id: "01ROOM", name: "Grade 2 · Juntos · Pam Shrestha · Rm 322" },
    ]);
  });

  it("says [] for the adult on the same roster, never absent", async () => {
    // Absent and empty mean different things on `GroupMemberDTO`. A household
    // roster looked, so the parent's answer is "none", not "nobody asked".
    //
    // Dana sits on Room 322's roster beside Milo and is not a student, so only
    // the `student` clause keeps the room off her row — "Dana Ruiz · Parent ·
    // Grade 2 · Rm 322" would say she is a pupil in the room she runs.
    const { members } = await roster("household");
    expect(members.find((m) => m.personId === DANA)?.classrooms).toEqual([]);
    expect(members.find((m) => m.personId === MILO)?.classrooms).toHaveLength(1);
  });

  it("never labels a row with the household whose page it is", async () => {
    // Dropping `g.kind = 'classroom'` would put "The Ruiz Household" on every
    // row of the household's own page. The fake would return it, so this fails.
    const { members } = await roster("household");
    for (const m of members) {
      for (const room of m.classrooms ?? []) {
        expect(room.id).not.toBe(GROUP_ID);
        expect(room.name).not.toBe("The Ruiz Household");
      }
    }
  });

  it("does not read rooms at all for a classroom's own roster", async () => {
    // The page IS the room, so the label would repeat its title on every row —
    // and this route rolls up a SUBTREE, so on a school group that pointless
    // read spans the whole school. The field is absent, not empty.
    const { members, seen } = await roster("classroom");
    expect(roomRead(seen)).toHaveLength(0);
    for (const m of members) expect(m.classrooms).toBeUndefined();
  });

  it("reads the rooms once, bound to the roster's ids", async () => {
    const { seen } = await roster("household");
    const reads = roomRead(seen);
    expect(reads).toHaveLength(1);
    // Never `FROM person`: who is on this roster was settled by the gated
    // statement above, so this only labels them and spends no exemption.
    expect(reads[0]!.sql).not.toMatch(/\b(FROM|JOIN)\s+person\b/);
  });
});
