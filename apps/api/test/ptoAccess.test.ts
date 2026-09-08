// The PTO boards' two seams: who may use them at all (`ptoAccess`), and what a
// Person on a card is called (`ptoRosterOf` / `assignableRoster`).
//
// This is the behavioural twin of test/slackNotify.test.ts, and it is
// behavioural for the same reason that one is. `test/personListable.test.ts`
// scans the source and can tell that a statement composes `personListableSql`;
// it cannot tell that the predicate the seam produced actually GATES anything —
// `personListableSql(x, true)` short-circuits to the literal "1", which reads
// like a guard, satisfies the scan and gates nothing. Two independent designs
// for the Slack feature made exactly that mistake. So the fake D1 below HONOURS
// the guard rather than assuming it: a guard that collapsed to "1" fails these
// tests with a real name in the result.
//
// Four properties, each with a test that fails loudly:
//
//   1. A system admin is always in; with no group configured, ONLY they are.
//   2. A `self_asserted = 1` membership does not admit. Only classrooms can be
//      self-asserted today (invariant 27), so this is a test of a rule that
//      cannot currently be violated — which is precisely when it is cheap to
//      pin, and the day someone widens that door is the day it earns its keep.
//   3. An unlisted Person is not named, and their card still reads as assigned.
//   4. The assignable roster is the group's roster, gated — never the school.

import { describe, expect, it } from "vitest";
import type { AuthContext, Env } from "../src/env.js";
import {
  PTO_GROUP_SETTING,
  assignableRoster,
  ptoAccess,
  ptoRosterOf,
  viewerOf,
  midpoint,
  appendPosition,
} from "../src/lib/ptoBoard.js";

const GROUP = "01GRP_PTO_BOARD";

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: "full" | "initial";
  unlisted_at: string | null;
}

const PEOPLE: PersonRow[] = [
  { id: "01DANA", first_name: "Dana", last_name: "Ruiz", last_name_visibility: "full", unlisted_at: null },
  { id: "01SAM", first_name: "Sam", last_name: "Okonkwo", last_name_visibility: "initial", unlisted_at: null },
  // On the PTO board AND off the directory roster. Both facts are true at once,
  // and the feature has to hold both: they may be assigned a card, and their
  // name may not be shown to an ordinary member.
  { id: "01HIDDEN", first_name: "Jo", last_name: "Nguyen", last_name_visibility: "full", unlisted_at: "2026-05-01T00:00:00.000Z" },
  { id: "01OUTSIDER", first_name: "Kai", last_name: "Berg", last_name_visibility: "full", unlisted_at: null },
];

interface MembershipRow {
  group_id: string;
  person_id: string;
  self_asserted: 0 | 1;
}

interface ControlRow {
  user_id: string;
  person_id: string;
}

/** The enumeration guard as it appears in a statement that carries a live one.
 *
 *  Matching the PREDICATE rather than the presence of a `personListableSql`
 *  call is what proves the gate is not the literal "1" — the failure mode
 *  test/personListable.test.ts's source scan cannot see. */
const GUARD = /unlisted_at IS NULL/;

/** …and the Controller exemption inside it, which the fake below honours too.
 *  Without this half, the fake would withhold an unlisted Person from their own
 *  Controller and the test suite would happily pin the WRONG behaviour. */
const CONTROLLER_EXEMPTION = /SELECT person_id FROM control WHERE user_id = \?/;

interface World {
  setting: string | null;
  memberships: MembershipRow[];
  controls: ControlRow[];
}

/**
 * A D1 stand-in that answers only the statements these seams issue and throws
 * on anything else — the "narrow on purpose" idea the fakes in
 * newsletterSubscribe.test.ts and slackNotify.test.ts use.
 *
 * It EVALUATES the enumeration guard rather than assuming it: an unlisted row
 * comes back when the SQL carries no guard, and comes back to a Controller when
 * the guard's control subquery is present and the viewer's bind controls them.
 * So a regression that dropped the guard shows up as a leaked name, and one that
 * dropped the exemption shows up as a Controller who can't see their own Person.
 */
function fakeEnv(world: World): Env {
  /** Which of a statement's binds is the viewer's user id, per the world. */
  const viewerOfBinds = (binds: unknown[]): string | null =>
    (binds.find((b) => world.controls.some((c) => c.user_id === b)) as string | undefined) ?? null;

  /** The real predicate, evaluated. */
  const listable = (row: PersonRow, sql: string, binds: unknown[]): boolean => {
    if (row.unlisted_at === null) return true;
    if (!GUARD.test(sql)) return true; // no guard at all — the leak this catches
    if (!CONTROLLER_EXEMPTION.test(sql)) return false;
    const viewer = viewerOfBinds(binds);
    return !!viewer && world.controls.some((c) => c.user_id === viewer && c.person_id === row.id);
  };

  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes("FROM setting")) {
                return world.setting ? ({ value: world.setting } as T) : null;
              }
              if (sql.includes("FROM grp")) {
                return binds[0] === GROUP ? ({ id: GROUP, name: "PTO Board" } as T) : null;
              }
              // The gate itself: membership × control, self_asserted honoured.
              if (sql.includes("FROM membership m") && sql.includes("JOIN control")) {
                const [groupId, userId] = binds as [string, string];
                const ok = world.memberships.some(
                  (m) =>
                    m.group_id === groupId &&
                    // Honoured, not assumed — a gate that dropped this clause
                    // would admit a self-asserted membership and fail the test.
                    (sql.includes("self_asserted = 0") ? m.self_asserted === 0 : true) &&
                    world.controls.some((c) => c.user_id === userId && c.person_id === m.person_id),
                );
                return ok ? ({ ok: 1 } as T) : null;
              }
              throw new Error(`fakeDb: unhandled first(): ${sql}`);
            },
            async all<T>(): Promise<{ results: T[] }> {
              // Dispatched on the statement's own shape, most specific first.
              // `personListableSql` embeds "FROM control WHERE user_id = ?" in
              // every guarded read of `person`, so a looser test on that string
              // would swallow both person queries below.
              if (sql.trimStart().startsWith("SELECT person_id FROM control")) {
                return {
                  results: world.controls.filter((c) => c.user_id === binds[0]) as unknown as T[],
                };
              }
              // assignableRoster: `FROM person p JOIN membership m …`.
              if (sql.includes("FROM person p")) {
                const groupId = binds[0] as string;
                const rows = PEOPLE.filter((p) =>
                  world.memberships.some(
                    (m) =>
                      m.group_id === groupId &&
                      m.person_id === p.id &&
                      (sql.includes("self_asserted = 0") ? m.self_asserted === 0 : true),
                  ),
                ).filter((p) => listable(p, sql, binds));
                return { results: rows as unknown as T[] };
              }
              // ptoRosterOf: `FROM person WHERE id IN (…) AND <guard>`.
              if (sql.includes("FROM person")) {
                const rows = PEOPLE.filter((p) => binds.includes(p.id)).filter((p) =>
                  listable(p, sql, binds),
                );
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

function auth(userId: string, isSystemAdmin = false): AuthContext {
  return {
    userId,
    realUserId: userId,
    email: `${userId}@eisenhower.edu`,
    isSystemAdmin,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
  };
}

const WORLD: World = {
  setting: GROUP,
  memberships: [
    { group_id: GROUP, person_id: "01DANA", self_asserted: 0 },
    { group_id: GROUP, person_id: "01HIDDEN", self_asserted: 0 },
    // On the roster, but ASSERTED rather than granted. Being on a list and
    // being trusted by it are different things — migration 0023's whole point.
    { group_id: GROUP, person_id: "01SAM", self_asserted: 1 },
  ],
  controls: [
    { user_id: "01U_DANA", person_id: "01DANA" },
    { user_id: "01U_SAM", person_id: "01SAM" },
    { user_id: "01U_HIDDEN", person_id: "01HIDDEN" },
    { user_id: "01U_OUT", person_id: "01OUTSIDER" },
  ],
};

describe("ptoAccess — who may open the boards", () => {
  it("admits a member who controls a Person on the roster", async () => {
    const access = await ptoAccess(fakeEnv(WORLD), auth("01U_DANA"));
    expect(access.canUse).toBe(true);
    expect(access.groupName).toBe("PTO Board");
  });

  it("refuses a member who controls nobody on the roster", async () => {
    expect((await ptoAccess(fakeEnv(WORLD), auth("01U_OUT"))).canUse).toBe(false);
  });

  // The rule that cannot currently be violated, pinned before it can be.
  it("does NOT admit a self-asserted membership", async () => {
    expect((await ptoAccess(fakeEnv(WORLD), auth("01U_SAM"))).canUse).toBe(false);
  });

  it("always admits a system admin, and admits ONLY them with no group set", async () => {
    const bare: World = { setting: null, memberships: [], controls: WORLD.controls };
    expect((await ptoAccess(fakeEnv(bare), auth("01U_ADMIN", true))).canUse).toBe(true);
    expect((await ptoAccess(fakeEnv(bare), auth("01U_ADMIN", true))).groupName).toBeNull();
    expect((await ptoAccess(fakeEnv(bare), auth("01U_DANA"))).canUse).toBe(false);
  });

  it("reports the configured group so the refusal card can name it", async () => {
    const access = await ptoAccess(fakeEnv(WORLD), auth("01U_OUT"));
    expect(access.groupId).toBe(GROUP);
    expect(access.groupName).toBe("PTO Board");
  });
});

describe("ptoRosterOf — what a Person on a card is called", () => {
  it("withholds an unlisted Person from an ordinary member", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_DANA"));
    const roster = await ptoRosterOf(env, viewer, ["01DANA", "01HIDDEN"]);

    expect(roster.get("01DANA")?.displayName).toBe("Dana Ruiz");
    // Absent, so the caller renders the generic label — never their name.
    expect(roster.has("01HIDDEN")).toBe(false);
    expect([...roster.values()].map((p) => p.displayName)).not.toContain("Jo Nguyen");
  });

  // The other half of invariant 21: the gate admits a system admin and a
  // Controller. Getting this wrong the other way would hide a family's own
  // Person from them, which is the confusing outcome rather than the private
  // one — the reason `buildProfile` tells a Controller about the flag at all.
  it("shows an unlisted Person to their own Controller", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_HIDDEN"));
    const roster = await ptoRosterOf(env, viewer, ["01HIDDEN"]);
    expect(roster.get("01HIDDEN")?.displayName).toBe("Jo Nguyen");
  });

  // A system admin short-circuits `personListableSql` to the literal "1", so
  // this is the one case where the guard is legitimately absent — and the case
  // that makes a purely textual check of the SQL insufficient.
  it("shows an unlisted Person to a system admin", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_ADMIN", true));
    const roster = await ptoRosterOf(env, viewer, ["01HIDDEN"]);
    expect(roster.get("01HIDDEN")?.displayName).toBe("Jo Nguyen");
  });

  it("applies the last-name display rule", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_DANA"));
    const roster = await ptoRosterOf(env, viewer, ["01SAM"]);
    expect(roster.get("01SAM")?.displayName).toBe("Sam O.");
  });

  it("marks the viewer's own Persons", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_DANA"));
    const roster = await ptoRosterOf(env, viewer, ["01DANA", "01SAM"]);
    expect(roster.get("01DANA")?.isYou).toBe(true);
    expect(roster.get("01SAM")?.isYou).toBe(false);
  });
});

describe("assignableRoster — who a card may be assigned to", () => {
  it("is the group's roster, not the school", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_DANA"));
    const ids = (await assignableRoster(env, viewer)).map((p) => p.id);
    expect(ids).toContain("01DANA");
    expect(ids).not.toContain("01OUTSIDER");
  });

  it("excludes a self-asserted membership, like the gate does", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_DANA"));
    expect((await assignableRoster(env, viewer)).map((p) => p.id)).not.toContain("01SAM");
  });

  it("excludes an unlisted Person from an ordinary member's picker", async () => {
    const env = fakeEnv(WORLD);
    const viewer = await viewerOf(env, auth("01U_DANA"));
    expect((await assignableRoster(env, viewer)).map((p) => p.id)).not.toContain("01HIDDEN");
  });

  it("offers nobody when no group is configured, rather than everybody", async () => {
    const env = fakeEnv({ setting: null, memberships: WORLD.memberships, controls: WORLD.controls });
    const viewer = await viewerOf(env, auth("01U_ADMIN", true));
    expect(await assignableRoster(env, viewer)).toEqual([]);
  });
});

describe("ordering arithmetic", () => {
  it("appends past the current maximum", () => {
    expect(appendPosition([])).toBeGreaterThan(0);
    expect(appendPosition([{ position: 1024 }, { position: 2048 }])).toBeGreaterThan(2048);
  });

  it("lands between two neighbours", () => {
    const p = midpoint(1000, 2000);
    expect(p).toBe(1500);
  });

  it("handles the top and the bottom of a column", () => {
    expect(midpoint(null, 1000)).toBeLessThan(1000);
    expect(midpoint(1000, null)).toBeGreaterThan(1000);
    expect(midpoint(null, null)).toBeGreaterThan(0);
  });

  // Floats run out of room after enough midpoints between the same pair. The
  // caller's answer is to normalize the column and try again — which is only
  // possible because this reports the condition instead of silently returning a
  // position equal to one of its neighbours.
  it("reports a collapsed gap rather than returning a duplicate position", () => {
    expect(midpoint(1000, 1000.000_01)).toBeNull();
  });
});

describe("the setting key", () => {
  it("is the one name the gate and the settings route agree on", () => {
    expect(PTO_GROUP_SETTING).toBe("pto_board_group_id");
  });
});
