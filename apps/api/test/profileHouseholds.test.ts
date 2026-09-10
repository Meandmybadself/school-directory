// The profile's household roster: the other Persons a Person shares a household
// with, which is the whole of what "family" means in this schema — there is no
// Person→Person edge anywhere in it, so co-residence is the only relation there
// is to render.
//
// This is BEHAVIOURAL, not textual, for the reason ptoAccess.test.ts and
// slackNotify.test.ts are. test/personListable.test.ts scans the source and can
// see that this statement composes `personListableSql`; it cannot see whether
// the predicate that seam produced actually GATES anything —
// `personListableSql(x, true)` short-circuits to the literal "1", which reads
// like a guard, satisfies the scan and gates nothing. So the fake D1 below
// EVALUATES the guard: a regression that dropped it fails these tests with a
// real name in the result.
//
// Six properties:
//
//   1. The subject is never a co-member of their own household.
//   2. Households only — a classroom co-membership contributes nothing.
//   3. An unlisted co-member is absent for an ordinary member…
//   4. …and present for a User who controls them (the gate's other audience).
//   5. A household the gate empties is omitted, never serialized with `members: []`
//      — the profile falls back to the member count for exactly those, and the
//      count/roster pair must stay a swap rather than a comparison.
//   6. The surname rule is applied per member, not wholesale: your own child is
//      spelled out on someone else's profile.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { householdsFor } from "../src/lib/serialize.js";
import type { Viewer } from "../src/lib/privacy.js";

const HH_RUIZ = "01GRP_RUIZ";
const HH_QUIET = "01GRP_QUIET";
const ROOM_3B = "01GRP_ROOM3B";

const DANA = "01DANA"; // the profile being viewed
const MILO = "01MILO";
const SAM = "01SAM";
const JO = "01JO"; // unlisted, in HH_RUIZ
const GHOST = "01GHOST"; // unlisted, the ONLY co-member of HH_QUIET
const KAI = "01KAI"; // classroom-only, must never appear

const U_MEMBER = "01USR_MEMBER"; // an ordinary member, controls Kai
const U_JO = "01USR_JO"; // controls Jo and Ghost

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: "full" | "initial";
  photo_object_key: string | null;
  unlisted_at: string | null;
}

const PEOPLE: PersonRow[] = [
  { id: DANA, first_name: "Dana", last_name: "Ruiz", last_name_visibility: "full", photo_object_key: null, unlisted_at: null },
  { id: MILO, first_name: "Milo", last_name: "Ruiz", last_name_visibility: "full", photo_object_key: "ph_milo", unlisted_at: null },
  // Held at `initial`, so an ordinary member reads "Sam O." — the display rule
  // has to travel with the name into this block like anywhere else.
  { id: SAM, first_name: "Sam", last_name: "Okonkwo", last_name_visibility: "initial", photo_object_key: null, unlisted_at: null },
  { id: JO, first_name: "Jo", last_name: "Nguyen", last_name_visibility: "full", photo_object_key: null, unlisted_at: "2026-05-01T00:00:00.000Z" },
  { id: GHOST, first_name: "Wren", last_name: "Nguyen", last_name_visibility: "full", photo_object_key: null, unlisted_at: "2026-05-01T00:00:00.000Z" },
  { id: KAI, first_name: "Kai", last_name: "Berg", last_name_visibility: "full", photo_object_key: null, unlisted_at: null },
];

const GROUPS: Record<string, { name: string; kind: string }> = {
  [HH_RUIZ]: { name: "The Ruiz Household", kind: "household" },
  [HH_QUIET]: { name: "Quiet House", kind: "household" },
  [ROOM_3B]: { name: "Room 3B", kind: "classroom" },
};

const MEMBERSHIPS: { group_id: string; person_id: string }[] = [
  { group_id: HH_RUIZ, person_id: DANA },
  { group_id: HH_RUIZ, person_id: MILO },
  { group_id: HH_RUIZ, person_id: SAM },
  { group_id: HH_RUIZ, person_id: JO },
  { group_id: HH_QUIET, person_id: DANA },
  { group_id: HH_QUIET, person_id: GHOST },
  // Dana and Kai share a CLASSROOM. Nothing from here may reach the block.
  { group_id: ROOM_3B, person_id: DANA },
  { group_id: ROOM_3B, person_id: KAI },
];

const CONTROLS: { user_id: string; person_id: string }[] = [
  { user_id: U_MEMBER, person_id: KAI },
  { user_id: U_JO, person_id: JO },
  { user_id: U_JO, person_id: GHOST },
];

const CAPABILITIES: { person_id: string; capability: string }[] = [
  { person_id: MILO, capability: "student" },
  { person_id: SAM, capability: "parent" },
  { person_id: JO, capability: "student" },
];

/** The enumeration guard as it appears in a statement carrying a LIVE one.
 *  Matching the predicate rather than a `personListableSql` call is what proves
 *  the gate isn't the literal "1". */
const GUARD = /unlisted_at IS NULL/;

/** Its Controller half. Without honouring this, the fake would withhold an
 *  unlisted Person from their own Controller and pin the WRONG behaviour. */
const CONTROLLER_EXEMPTION = /SELECT person_id FROM control WHERE user_id = \?/;

/** A D1 stand-in answering only the three statements `householdsFor` issues,
 *  and throwing on anything else. It evaluates the guard rather than assuming
 *  it, and it honours `g.kind = 'household'` and `m.person_id != ?` the same
 *  way — so dropping any of the three shows up as a name in an assertion. */
function fakeEnv(): Env {
  const viewerOfBinds = (binds: unknown[]): string | null =>
    (binds.find((b) => CONTROLS.some((c) => c.user_id === b)) as string | undefined) ?? null;

  const listable = (row: PersonRow, sql: string, binds: unknown[]): boolean => {
    if (row.unlisted_at === null) return true;
    if (!GUARD.test(sql)) return true; // no guard at all — the leak this catches
    if (!CONTROLLER_EXEMPTION.test(sql)) return false;
    const viewer = viewerOfBinds(binds);
    return !!viewer && CONTROLS.some((c) => c.user_id === viewer && c.person_id === row.id);
  };

  const db = {
    prepare(sql: string) {
      const q = sql.trimStart();
      return {
        bind(...binds: unknown[]) {
          return {
            async all<T>(): Promise<{ results: T[] }> {
              // Order matters: the guard embeds "SELECT person_id FROM control
              // WHERE user_id = ?" into the roster statement too, so the most
              // specific shapes are matched first.
              if (q.startsWith("SELECT person_id, capability")) {
                return {
                  results: CAPABILITIES.filter((c) => binds.includes(c.person_id)) as unknown as T[],
                };
              }
              if (q.startsWith("SELECT person_id FROM control")) {
                return {
                  results: CONTROLS.filter(
                    (c) => c.user_id === binds[0] && binds.includes(c.person_id),
                  ) as unknown as T[],
                };
              }
              if (q.startsWith("SELECT m.group_id")) {
                const subject = binds[0] as string;
                const mine = new Set(
                  MEMBERSHIPS.filter((m) => m.person_id === subject).map((m) => m.group_id),
                );
                const rows = MEMBERSHIPS.filter((m) => mine.has(m.group_id))
                  // Honoured, not assumed. Drop this and Room 3B's Kai appears.
                  .filter((m) => (sql.includes("'household'") ? GROUPS[m.group_id]!.kind === "household" : true))
                  // Likewise: drop this and Dana is her own housemate.
                  .filter((m) => (sql.includes("m.person_id != ?") ? m.person_id !== subject : true))
                  .map((m) => ({ m, p: PEOPLE.find((p) => p.id === m.person_id)! }))
                  .filter(({ p }) => listable(p, sql, binds))
                  .sort(
                    (a, b) =>
                      GROUPS[a.m.group_id]!.name.localeCompare(GROUPS[b.m.group_id]!.name) ||
                      a.p.first_name.localeCompare(b.p.first_name),
                  )
                  .map(({ m, p }) => ({
                    group_id: m.group_id,
                    group_name: GROUPS[m.group_id]!.name,
                    id: p.id,
                    first_name: p.first_name,
                    last_name: p.last_name,
                    last_name_visibility: p.last_name_visibility,
                    photo_object_key: p.photo_object_key,
                  }));
                return { results: rows as unknown as T[] };
              }
              throw new Error(`fakeDb: unhandled all(): ${sql}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;

  return { DB: db } as unknown as Env;
}

const viewer = (userId: string): Viewer => ({ userId, personId: null });

const forViewer = (userId: string, opts: { isSystemAdmin?: boolean; asMember?: boolean } = {}) =>
  householdsFor(fakeEnv(), viewer(userId), DANA, {
    isSystemAdmin: opts.isSystemAdmin === true,
    asMember: opts.asMember === true,
  });

describe("a profile's household roster", () => {
  it("names the co-members and never the subject", async () => {
    const hh = await forViewer(U_MEMBER);
    const ruiz = hh.find((h) => h.id === HH_RUIZ);
    expect(ruiz).toBeDefined();
    expect(ruiz!.name).toBe("The Ruiz Household");
    expect(ruiz!.members.map((m) => m.id)).not.toContain(DANA);
  });

  it("is households only — a shared classroom contributes nobody", async () => {
    const hh = await forViewer(U_MEMBER);
    expect(hh.map((h) => h.id)).not.toContain(ROOM_3B);
    const everyone = hh.flatMap((h) => h.members.map((m) => m.id));
    expect(everyone).not.toContain(KAI);
  });

  it("withholds an unlisted co-member from an ordinary member", async () => {
    const hh = await forViewer(U_MEMBER);
    const everyone = hh.flatMap((h) => h.members);
    expect(everyone.map((m) => m.id)).toEqual([MILO, SAM]);
    // Said the other way round, because this is the assertion that fails loudly
    // if the guard ever collapses to "1": the NAME must not be in the response.
    expect(JSON.stringify(hh)).not.toContain("Nguyen");
    expect(JSON.stringify(hh)).not.toContain("Jo");
  });

  it("shows that same co-member to a User who controls them", async () => {
    const hh = await forViewer(U_JO);
    const ruiz = hh.find((h) => h.id === HH_RUIZ)!;
    expect(ruiz.members.map((m) => m.id)).toEqual([JO, MILO, SAM]);
    expect(ruiz.members.find((m) => m.id === JO)!.displayName).toBe("Jo Nguyen");
  });

  it("omits a household the gate empties rather than serializing it empty", async () => {
    // Quiet House holds Dana and one unlisted Person. For an ordinary member
    // there is nobody to show, so the household must not appear at all — the
    // profile falls back to `memberCount` for exactly this case, and a household
    // rendering both a count and an empty roster is the comparison the swap
    // exists to prevent.
    const member = await forViewer(U_MEMBER);
    expect(member.map((h) => h.id)).toEqual([HH_RUIZ]);
    expect(member.every((h) => h.members.length > 0)).toBe(true);

    // …and it does appear for Ghost's Controller, so the omission is the gate
    // doing its work rather than households being dropped wholesale.
    const controller = await forViewer(U_JO);
    expect(controller.map((h) => h.id).sort()).toEqual([HH_QUIET, HH_RUIZ].sort());
  });

  it("applies the surname rule per member, not wholesale", async () => {
    const hh = await forViewer(U_MEMBER);
    const members = hh.flatMap((h) => h.members);
    expect(members.find((m) => m.id === SAM)!.displayName).toBe("Sam O.");
    expect(members.find((m) => m.id === MILO)!.displayName).toBe("Milo Ruiz");

    // Jo is spelled out for their Controller while Sam, whom that same User does
    // NOT control, stays an initial on the very same response.
    const asController = (await forViewer(U_JO)).flatMap((h) => h.members);
    expect(asController.find((m) => m.id === JO)!.displayName).toBe("Jo Nguyen");
    expect(asController.find((m) => m.id === SAM)!.displayName).toBe("Sam O.");
  });

  it("carries capabilities — the nearest thing here to parent and child", async () => {
    const hh = await forViewer(U_MEMBER);
    const members = hh.flatMap((h) => h.members);
    expect(members.find((m) => m.id === MILO)!.capabilities).toEqual(["student"]);
    expect(members.find((m) => m.id === SAM)!.capabilities).toEqual(["parent"]);
  });

  it("drops the Controller surname exemption under preview-as-member", async () => {
    // A Controller asking to see the profile through a member's eyes must be
    // shown the member's spelling. Findability is deliberately NOT affected —
    // the same split buildProfile draws between `asMember` and `isSystemAdmin`.
    const hh = await forViewer(U_JO, { asMember: true });
    const jo = hh.flatMap((h) => h.members).find((m) => m.id === JO)!;
    expect(jo.displayName).toBe("Jo Nguyen"); // held at `full`, so unchanged
    const members = hh.flatMap((h) => h.members);
    expect(members.find((m) => m.id === SAM)!.displayName).toBe("Sam O.");
  });

  it("serializes only the fields the wire shape declares", async () => {
    const hh = await forViewer(U_MEMBER);
    expect(Object.keys(hh[0]!).sort()).toEqual(["id", "members", "name"]);
    // Built field by field: a spread of the row would put `last_name` and
    // `photo_object_key` beside the display name that exists to withhold them.
    expect(Object.keys(hh[0]!.members[0]!).sort()).toEqual(
      ["capabilities", "displayName", "firstName", "id", "photoUrl"].sort(),
    );
  });
});
