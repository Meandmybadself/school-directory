// GET /home/neighbors — the rooms a neighbour card names.
//
// "Who lives nearby" is asked in order to find the family whose child is in the
// same room, so the card carries the household's children's classrooms. Both
// kinds of card resolve to a HOUSEHOLD: a household card is its own roster, a
// person card is the households that Person belongs to.
//
// These checks are BEHAVIOURAL for the reason directoryClassroom.test.ts,
// profileHouseholds.test.ts and ptoAccess.test.ts give: the fake D1 evaluates
// the statements' own terms, so a read that dropped `g.kind = 'classroom'`
// fails with a HOUSEHOLD's name on a card, and a co-member read whose gate
// collapsed to the literal "1" fails with an unlisted child's room on one —
// neither of which a text scan can see.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { home } from "../src/routes/home.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

const MEMBER: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "parent@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01ME",
  isMasquerading: false,
};

const ADMIN: AuthContext = { ...MEMBER, userId: "01ADMIN", realUserId: "01ADMIN", isSystemAdmin: true };

const ORIGIN = { geo_lat: 44.9, geo_lng: -93.4 };
/** ~0.14 mi from the origin — inside the 2-mile radius, well clear of it. */
const NEAR = { geo_lat: 44.902, geo_lng: -93.4 };

/** Everyone in the fixture. `unlisted_at` is what the enumeration gate reads. */
const PERSONS = [
  { id: "01PARENT", first_name: "Dana", last_name: "Ruiz", last_name_visibility: "full" as const, unlisted_at: null },
  { id: "01LONER", first_name: "Sam", last_name: "Okafor", last_name_visibility: "full" as const, unlisted_at: null },
  { id: "01KID_A1", first_name: "Milo", last_name: "Ruiz", last_name_visibility: "full" as const, unlisted_at: null },
  { id: "01KID_A2", first_name: "Rosa", last_name: "Ruiz", last_name_visibility: "full" as const, unlisted_at: null },
  { id: "01KID_A3", first_name: "Ines", last_name: "Ruiz", last_name_visibility: "full" as const, unlisted_at: null },
  { id: "01ADULT_B", first_name: "Yusuf", last_name: "Kaya", last_name_visibility: "full" as const, unlisted_at: null },
  { id: "01KID_B1", first_name: "Hana", last_name: "Kaya", last_name_visibility: "full" as const, unlisted_at: "2026-01-01T00:00:00Z" },
  { id: "01KID_B2", first_name: "Omar", last_name: "Kaya", last_name_visibility: "full" as const, unlisted_at: null },
];

const CAPABILITIES = [
  { person_id: "01KID_A1", capability: "student" },
  { person_id: "01KID_A2", capability: "student" },
  { person_id: "01KID_A3", capability: "student" },
  { person_id: "01KID_B1", capability: "student" },
  { person_id: "01KID_B2", capability: "student" },
  { person_id: "01PARENT", capability: "parent" },
  { person_id: "01ADULT_B", capability: "parent" },
];

/** `membership × grp`, flattened. Two siblings share Room 12 — the dedupe case —
 *  and Dana runs it, which only the `student` clause keeps off the card. */
const MEMBERSHIPS = [
  { person_id: "01ME", id: "01HH_ME", name: "Our household", kind: "household" },

  { person_id: "01PARENT", id: "01HH_A", name: "The Ruiz household", kind: "household" },
  { person_id: "01KID_A1", id: "01HH_A", name: "The Ruiz household", kind: "household" },
  { person_id: "01KID_A2", id: "01HH_A", name: "The Ruiz household", kind: "household" },
  { person_id: "01KID_A3", id: "01HH_A", name: "The Ruiz household", kind: "household" },
  { person_id: "01KID_A1", id: "01ROOM12", name: "Room 12 — Ms. Okonkwo", kind: "classroom" },
  { person_id: "01KID_A2", id: "01ROOM12", name: "Room 12 — Ms. Okonkwo", kind: "classroom" },
  { person_id: "01KID_A3", id: "01ROOM3", name: "Room 3 — Mr. Alvarez", kind: "classroom" },
  // Dana teaches Room 12. Without the `student` clause the card says she is in it.
  { person_id: "01PARENT", id: "01ROOM12", name: "Room 12 — Ms. Okonkwo", kind: "classroom" },

  { person_id: "01ADULT_B", id: "01HH_B", name: "The Kaya household", kind: "household" },
  { person_id: "01KID_B1", id: "01HH_B", name: "The Kaya household", kind: "household" },
  { person_id: "01KID_B2", id: "01HH_B", name: "The Kaya household", kind: "household" },
  // Hana is unlisted. Her room may not reach an ordinary member's card.
  { person_id: "01KID_B1", id: "01ROOM7", name: "Room 7 — Ms. Kaur", kind: "classroom" },
  { person_id: "01KID_B2", id: "01ROOM3", name: "Room 3 — Mr. Alvarez", kind: "classroom" },
];

interface Seen { sql: string; args: unknown[] }

/** Honours the terms a statement carries — including the enumeration gate, which
 *  is the one a source scan cannot check (invariant 22: `personListableSql`
 *  short-circuits to the literal "1" for an admin, which reads like a guard). */
function rowsFor(sql: string, args: unknown[], auth: AuthContext): unknown[] {
  const ids = new Set(args.map(String));
  const listable = (personId: string): boolean => {
    if (!sql.includes("unlisted_at IS NULL")) return true; // guard absent: everyone through
    const p = PERSONS.find((x) => x.id === personId);
    if (!p || p.unlisted_at === null) return true;
    return false; // nobody in this fixture is controlled by the viewer
  };

  // The viewer's own households (route's first read).
  if (sql.includes("SELECT g.id FROM membership")) {
    return MEMBERSHIPS.filter((m) => m.person_id === "01ME" && m.kind === "household").map((m) => ({ id: m.id }));
  }
  // The viewer's origin address; no household copy.
  if (sql.includes("FROM contact_item\n       WHERE owner_kind = 'person'")) return [ORIGIN];
  if (sql.includes("FROM contact_item\n         WHERE owner_kind = 'group'")) return [];
  // Person candidates.
  if (sql.includes("JOIN person p ON p.id = ci.owner_id")) {
    return ["01PARENT", "01LONER"]
      .filter(listable)
      .map((id) => {
        const p = PERSONS.find((x) => x.id === id)!;
        return { owner_id: id, ...NEAR, first_name: p.first_name, last_name: p.last_name, last_name_visibility: p.last_name_visibility };
      });
  }
  // Household candidates.
  if (sql.includes("JOIN grp g ON g.id = ci.owner_id")) {
    return [{ owner_id: "01HH_B", ...NEAR, name: "The Kaya household" }];
  }
  // Which households each person card belongs to.
  if (sql.includes("SELECT m.person_id, m.group_id")) {
    return MEMBERSHIPS.filter((m) => ids.has(m.person_id))
      .filter((m) => !sql.includes("g.kind = 'household'") || m.kind === "household")
      .map((m) => ({ person_id: m.person_id, group_id: m.id }));
  }
  // Those households' co-members — the gated read.
  if (sql.includes("SELECT m.group_id, m.person_id")) {
    return MEMBERSHIPS.filter((m) => ids.has(m.id))
      .filter((m) => listable(m.person_id))
      .map((m) => ({ group_id: m.id, person_id: m.person_id }));
  }
  // `classroomsByPerson`, unchanged and shared with three other listings.
  if (sql.includes("SELECT m.person_id, g.id, g.name")) {
    return MEMBERSHIPS.filter((m) => ids.has(m.person_id))
      .filter((m) => !sql.includes("g.kind = 'classroom'") || m.kind === "classroom")
      .filter((m) => !sql.includes("capability = 'student'")
        || CAPABILITIES.some((c) => c.person_id === m.person_id && c.capability === "student"))
      .map((m) => ({ person_id: m.person_id, id: m.id, name: m.name }));
  }
  void auth;
  return [];
}

function testEnv(seen: Seen[], auth: AuthContext): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async first() { seen.push({ sql, args: this.args }); return null; },
    async all() { seen.push({ sql, args: this.args }); return { results: rowsFor(sql, this.args, auth) }; },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

function app(auth: AuthContext): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    c.set("auth", auth);
    await next();
  }));
  a.route("/home", home);
  return a;
}

interface Body {
  neighbors: { id: string; kind: string; classrooms?: { id: string; name: string }[] }[];
}

async function neighbors(auth = MEMBER): Promise<{ body: Body; seen: Seen[] }> {
  const seen: Seen[] = [];
  const res = await app(auth).request("/home/neighbors", {}, testEnv(seen, auth));
  expect(res.status).toBe(200);
  return { body: (await res.json()) as Body, seen };
}

function roomsOf(body: Body, id: string): string[] {
  const card = body.neighbors.find((n) => n.id === id);
  expect(card).toBeTruthy();
  return (card!.classrooms ?? []).map((c) => c.name);
}

describe("GET /home/neighbors classroom labels", () => {
  it("names a person card's HOUSEHOLD's rooms, deduped across siblings", async () => {
    const { body } = await neighbors();
    // Dana's card carries her children's rooms, not her own memberships. Two of
    // the three children share Room 12, and it is named once.
    expect(roomsOf(body, "01PARENT")).toEqual(["Room 12 — Ms. Okonkwo", "Room 3 — Mr. Alvarez"]);
  });

  it("names a household card's own roster", async () => {
    // For an ordinary member Omar's room only: Hana is unlisted (next test).
    const { body } = await neighbors();
    expect(roomsOf(body, "01HH_B")).toEqual(["Room 3 — Mr. Alvarez"]);
  });

  it("withholds an unlisted child's room, and shows it to a system admin", async () => {
    // The gate this asserts is invariant 21's, and it is asserted BEHAVIOURALLY
    // because `personListableSql` short-circuits to the literal "1" — a
    // predicate that reads like a guard and gates nothing, which is exactly what
    // a source scan cannot tell apart from the real thing.
    const member = await neighbors(MEMBER);
    expect(roomsOf(member.body, "01HH_B")).not.toContain("Room 7 — Ms. Kaur");

    const admin = await neighbors(ADMIN);
    expect(roomsOf(admin.body, "01HH_B")).toEqual(["Room 3 — Mr. Alvarez", "Room 7 — Ms. Kaur"]);
  });

  it("names a room for a student and not for the adult who runs it", async () => {
    const { body } = await neighbors();
    // Dana is on Room 12's roster and is not a student. Her card names it only
    // because her CHILDREN are in it — drop the `student` clause and it would be
    // named for her too, which says she is a pupil in the room she teaches.
    expect(roomsOf(body, "01PARENT")).not.toContain("Our household");
    for (const n of body.neighbors) {
      expect((n.classrooms ?? []).map((c) => c.id)).not.toContain("01HH_A");
      expect((n.classrooms ?? []).map((c) => c.id)).not.toContain("01HH_B");
    }
  });

  it("gives a Person in no household an empty list, not a missing field", async () => {
    // `[]` is "no student in the household is on a roster" — the same rendering
    // as no household at all, which is deliberate: both are a card with no room
    // to name.
    const { body } = await neighbors();
    expect(roomsOf(body, "01LONER")).toEqual([]);
  });

  it("reads the whole row in two statements, never one per card", async () => {
    const { seen } = await neighbors();
    expect(seen.filter((s) => s.sql.includes("SELECT m.person_id, m.group_id")).length).toBe(1);
    const coMembers = seen.filter((s) => s.sql.includes("SELECT m.group_id, m.person_id"));
    expect(coMembers.length).toBe(1);
    // Bound to the households the cards resolved to, and to nothing else.
    expect(new Set(coMembers[0]!.args.slice(0, 2).map(String))).toEqual(new Set(["01HH_A", "01HH_B"]));
    expect(seen.filter((s) => s.sql.includes("SELECT m.person_id, g.id, g.name")).length).toBe(1);
  });

  it("asks for nothing when there are no neighbours to label", async () => {
    const seen: Seen[] = [];
    const env = { DB: { prepare: (sql: string) => ({
      args: [] as unknown[],
      bind(...args: unknown[]) { this.args = args; return this; },
      async first() { seen.push({ sql, args: this.args }); return null; },
      async all() {
        seen.push({ sql, args: this.args });
        // An origin, so the scan runs — and no candidates near it.
        return { results: sql.includes("FROM contact_item\n       WHERE owner_kind = 'person'") ? [ORIGIN] : [] };
      },
    }) } } as unknown as HonoEnv["Bindings"];
    const res = await app(MEMBER).request("/home/neighbors", {}, env);
    expect(res.status).toBe(200);
    expect(seen.some((s) => s.sql.includes("SELECT m.group_id, m.person_id"))).toBe(false);
    expect(seen.some((s) => s.sql.includes("SELECT m.person_id, g.id, g.name"))).toBe(false);
  });
});
