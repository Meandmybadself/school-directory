// GET /directory — the classroom a row names.
//
// The directory lists the whole school, so half the rows share a first name with
// another row and the surnames may be initials. The room is what tells them
// apart, and every classroom roster is already served to any authenticated
// member by `GET /groups/:id` (migration 0023's header says exactly that), so
// naming it here moves a readable fact to where it is asked rather than
// widening what the viewer may see.
//
// Two of the three checks below are BEHAVIOURAL, for the reason
// profileHouseholds.test.ts and ptoAccess.test.ts give: the fake D1 evaluates
// the statement's own terms, so a lookup that dropped `g.kind = 'classroom'`
// fails with a HOUSEHOLD's name on a row rather than passing a text scan. The
// third is textual and has to be — the guarantee there is the ABSENCE of a
// `self_asserted` clause, and an absent clause is not something a fake can
// evaluate.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { directory } from "../src/routes/directory.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

const VIEWER: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "parent@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01ME",
  isMasquerading: false,
};

/** Two children with the same first name — the case the room exists to settle —
 *  and a parent on no roster at all. */
const PERSONS = [
  { id: "01MILO_A", first_name: "Milo", last_name: "Ruiz", last_name_visibility: "initial" as const, photo_object_key: null },
  { id: "01MILO_B", first_name: "Milo", last_name: "Chen", last_name_visibility: "full" as const, photo_object_key: null },
  { id: "01DANA", first_name: "Dana", last_name: "Ruiz", last_name_visibility: "full" as const, photo_object_key: null },
];

/** `membership × grp`, flattened. The two Milos sit in different rooms; one of
 *  them is also in a second room, and everyone is in a household — which is the
 *  row that must NOT surface as a classroom. `self_asserted` is on one of the
 *  placements precisely because nothing may filter on it. */
/** Who is a student. Dana is the parent on a classroom roster — a room parent,
 *  or the teacher of it — and is what the `student` clause is for. */
const CAPABILITIES = [
  { person_id: "01MILO_A", capability: "student" },
  { person_id: "01MILO_B", capability: "student" },
  { person_id: "01DANA", capability: "parent" },
];

const MEMBERSHIPS = [
  { person_id: "01MILO_A", id: "01ROOM12", name: "Room 12 — Ms. Okonkwo", kind: "classroom", self_asserted: 1 },
  { person_id: "01MILO_B", id: "01ROOM3", name: "Room 3 — Mr. Alvarez", kind: "classroom", self_asserted: 0 },
  { person_id: "01MILO_B", id: "01BAND", name: "Beginning Band", kind: "classroom", self_asserted: 0 },
  { person_id: "01MILO_A", id: "01HH", name: "The Ruiz household", kind: "household", self_asserted: 0 },
  { person_id: "01DANA", id: "01HH", name: "The Ruiz household", kind: "household", self_asserted: 0 },
  // Dana runs Room 12. Only the `student` clause keeps that off her row.
  { person_id: "01DANA", id: "01ROOM12", name: "Room 12 — Ms. Okonkwo", kind: "classroom", self_asserted: 0 },
];

interface Seen {
  sql: string;
  args: unknown[];
}

function testEnv(seen: Seen[]): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      seen.push({ sql, args: this.args });
      return { n: PERSONS.length };
    },
    async all() {
      seen.push({ sql, args: this.args });
      return { results: rowsFor(sql, this.args) };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

/** The fake's whole point: it HONOURS the terms the statement carries. A read
 *  that stopped naming `g.kind = 'classroom'` gets the households back, and the
 *  assertions below see them. */
function rowsFor(sql: string, args: unknown[]): unknown[] {
  // Matched most-specific first. `personSearchSql` puts a `FROM control`
  // subquery inside the page statement, so a naive "does it mention control"
  // branch would answer the roster read with an empty list and quietly pass
  // every assertion below.
  if (sql.includes("person_id, capability")) return [];
  if (sql.includes("photo_object_key")) return PERSONS;
  if (sql.includes("FROM membership")) {
    const ids = new Set(args.map(String));
    return MEMBERSHIPS.filter((m) => ids.has(m.person_id))
      .filter((m) => !sql.includes("g.kind = 'classroom'") || m.kind === "classroom")
      // Honoured, not assumed: drop the clause and Dana the parent is labelled
      // with the room she teaches.
      .filter((m) => !sql.includes("capability = 'student'")
        || CAPABILITIES.some((c) => c.person_id === m.person_id && c.capability === "student"))
      .map((m) => ({ person_id: m.person_id, id: m.id, name: m.name }));
  }
  return [];
}

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    c.set("auth", VIEWER);
    await next();
  }));
  a.route("/directory", directory);
  return a;
}

interface Body {
  people: { id: string; classrooms?: { id: string; name: string }[] }[];
}

async function listing(url = "/directory"): Promise<{ body: Body; seen: Seen[] }> {
  const seen: Seen[] = [];
  const res = await app().request(url, {}, testEnv(seen));
  expect(res.status).toBe(200);
  return { body: (await res.json()) as Body, seen };
}

function roomsOf(body: Body, personId: string): string[] {
  const row = body.people.find((p) => p.id === personId);
  expect(row).toBeTruthy();
  return (row!.classrooms ?? []).map((c) => c.name);
}

describe("GET /directory classroom labels", () => {
  it("names each Person's own rooms, and only theirs", async () => {
    const { body, seen } = await listing();
    expect(roomsOf(body, "01MILO_A")).toEqual(["Room 12 — Ms. Okonkwo"]);
    // A child may legitimately hold more than one classroom membership — a
    // roster import invents a `classroom` for any group it names — so both come
    // back, and neither Milo gets the other's.
    expect(roomsOf(body, "01MILO_B").sort()).toEqual(["Beginning Band", "Room 3 — Mr. Alvarez"]);
    // The ORDER BY is asserted on the statement rather than the result: the fake
    // D1 returns fixture order, so a sorted expectation here would be pinning
    // the fixture. What matters is that a two-room row reads the same on every
    // load, and that is the clause's job.
    const read = seen.find((s) => s.sql.includes("FROM membership"))!;
    expect(read.sql).toMatch(/ORDER BY g\.name COLLATE NOCASE/);
  });

  it("names a room for a student and not for the adult who runs it", async () => {
    // Dana is on Room 12's roster and is not a student. The label answers
    // "which room is this child in", and a teacher's membership is a different
    // relationship that this line was never describing.
    const { body } = await listing();
    expect(roomsOf(body, "01DANA")).toEqual([]);
    expect(roomsOf(body, "01MILO_A")).toEqual(["Room 12 — Ms. Okonkwo"]);
  });

  it("does not pass a household off as a classroom", async () => {
    const { body } = await listing();
    // Dana is in a household and no classroom. Dropping `g.kind` from the read
    // would put "The Ruiz household" here — the failure this asserts against.
    expect(roomsOf(body, "01DANA")).toEqual([]);
    for (const p of body.people) {
      expect((p.classrooms ?? []).map((c) => c.id)).not.toContain("01HH");
    }
  });

  it("names a self-asserted placement like any other", async () => {
    const { body, seen } = await listing();
    // Milo A's only room was asserted by a parent under invariant 27, not
    // granted by whoever runs the room. That column decides what a membership
    // lets a viewer READ; it does not decide who is on the list, and filtering
    // on it here would hide the placement from the parent who just made it.
    expect(roomsOf(body, "01MILO_A")).toEqual(["Room 12 — Ms. Okonkwo"]);
    const read = seen.find((s) => s.sql.includes("FROM membership"));
    expect(read).toBeTruthy();
    expect(read!.sql).not.toContain("self_asserted");
  });

  it("reads the rooms in one statement, bound to the page's ids", async () => {
    const { seen } = await listing();
    const reads = seen.filter((s) => s.sql.includes("FROM membership"));
    expect(reads.length).toBe(1);
    // Never `FROM person` — which Persons are on this page was already settled
    // by `personSearchSql`, so this labels them and spends none of
    // personListable.test.ts's exemption budget.
    expect(reads[0]!.sql).not.toMatch(/\b(FROM|JOIN)\s+person\b/);
    expect(reads[0]!.args).toEqual(PERSONS.map((p) => p.id));
  });

  it("asks for nothing when the page is empty", async () => {
    const seen: Seen[] = [];
    const empty = { DB: { prepare: (sql: string) => ({
      args: [] as unknown[],
      bind(...args: unknown[]) { this.args = args; return this; },
      async first() { seen.push({ sql, args: this.args }); return { n: 0 }; },
      async all() { seen.push({ sql, args: this.args }); return { results: [] }; },
    }) } } as unknown as HonoEnv["Bindings"];
    const res = await app().request("/directory?q=nobody", {}, empty);
    expect(res.status).toBe(200);
    expect(seen.some((s) => s.sql.includes("FROM membership"))).toBe(false);
  });
});
