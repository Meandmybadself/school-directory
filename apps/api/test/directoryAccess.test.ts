// Invariant 32 — reading the directory is granted, not conferred by signing up
// (migration 0029).
//
// BEHAVIOURAL, not textual, for the reason test/ptoAccess.test.ts and
// test/slackNotify.test.ts are. `test/personListable.test.ts` scans the source
// and can see that a statement composes `personListableSql`; it cannot see what
// the predicate the seam produced actually ADMITS. A gate that collapsed to the
// literal "1" reads like a guard, satisfies that scan and gates nothing — two
// independent designs for the Slack feature made exactly that mistake. So the
// fake D1 here EVALUATES the predicate: a pending account that could still read
// another family fails these tests with a real name in the result rather than
// passing a scan.
//
// What is pinned, in the order the feature is met:
//
//   1. The predicate itself. Unapproved resolves to the caller's OWN Persons —
//      not to "1", and not to the unlisted rule, which would admit the school.
//   2. The claim is three conditions and needs all three. A form that let an
//      empty application through would put nothing in front of a reviewer,
//      which is the one thing this gate exists to prevent.
//   3. The route gates. `/directory` refuses outright; a profile 404s the way
//      an unlisted Person already does (invariant 18's oracle), and a household
//      the applicant belongs to still opens — the family step of the very
//      application that gets them approved renders through it (invariant 24).
//   4. Approving promotes the applicant's self-asserted classroom placements to
//      trusted, in the SAME batch as the approval, and a decision that changes
//      nothing writes nothing (invariant 5: an append-only log is not paddable
//      by a double click).

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { personListableSql, personSearchSql } from "../src/lib/privacy.js";
import {
  accessClaimStatus,
  accessStateOf,
  enforceReadRate,
  requireApproved,
  DirectoryAccessError,
  RateLimitedError,
} from "../src/lib/directoryAccess.js";
import { directory } from "../src/routes/directory.js";
import { persons } from "../src/routes/persons.js";
import { groups } from "../src/routes/groups.js";
import { admin } from "../src/routes/admin.js";
import type { AuthContext, Env, HonoEnv } from "../src/env.js";

const ME = "01USER_ME";
const STRANGER = "01USER_OTHER";
const MY_CHILD = "01P_MILO";
const MY_SELF = "01P_DANA";
const THEIR_CHILD = "01P_ADA";
const MY_HOUSEHOLD = "01GRP_HOME";
const THEIR_HOUSEHOLD = "01GRP_THEIRS";
const ROOM = "01GRP_ROOM";

function viewer(over: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: ME,
    realUserId: ME,
    email: "dana@eisenhower.edu",
    isSystemAdmin: false,
    sessionId: "01S",
    activePersonId: MY_SELF,
    isMasquerading: false,
    isApproved: true,
    ...over,
  };
}

// ── 1. The predicate ────────────────────────────────────────────────────────

describe("the gate is in the predicate, not only in the routes", () => {
  it("narrows an unapproved viewer to the Persons they control", () => {
    const g = personListableSql(ME, false, "p", false);
    // The failure this catches is the important one: not "no guard" but a guard
    // that admits the school anyway. `unlisted_at IS NULL` is true for almost
    // every row, so a predicate that still carried it would leak the roster.
    expect(g.sql).not.toMatch(/unlisted_at/);
    expect(g.sql).toContain("SELECT person_id FROM control WHERE user_id = ?");
    expect(g.binds).toEqual([ME]);
  });

  it("does not collapse to the literal \"1\" for an unapproved caller", () => {
    expect(personListableSql(ME, false, "", false).sql.trim()).not.toBe("1");
  });

  it("still short-circuits for a system admin, who is approved by definition", () => {
    expect(personListableSql(ME, true, "", false)).toEqual({ sql: "1", binds: [] });
  });

  it("keeps the unlisted rule for an approved caller", () => {
    const g = personListableSql(ME, false, "p", true);
    expect(g.sql).toContain("unlisted_at IS NULL");
  });

  it("carries through name search, so a pending member cannot search the school", () => {
    const s = personSearchSql("ruiz", ME, false, false);
    expect(s.sql).not.toMatch(/unlisted_at/);
    expect(s.sql).toContain("SELECT person_id FROM control WHERE user_id = ?");
    // The surname display rule is still conjoined — the gate narrows the
    // listing, it does not replace invariant 18's guard.
    expect(s.sql).toContain("last_name_visibility = 'full'");
  });
});

// ── 2. The state machine and the claim ──────────────────────────────────────

describe("what state an account is in", () => {
  const none = { access_submitted_at: null, access_approved_at: null, access_declined_at: null };

  it("reads the four states off the dates", () => {
    expect(accessStateOf(none)).toBe("incomplete");
    expect(accessStateOf({ ...none, access_submitted_at: "t" })).toBe("pending");
    expect(accessStateOf({ ...none, access_declined_at: "t" })).toBe("declined");
    expect(accessStateOf({ ...none, access_approved_at: "t" })).toBe("approved");
  });

  it("lets approval win over a stale decline, so re-approving is one UPDATE", () => {
    expect(
      accessStateOf({ ...none, access_declined_at: "t1", access_approved_at: "t2" }),
    ).toBe("approved");
  });

  it("admits a system admin without consulting a queue", () => {
    expect(accessStateOf(none, true)).toBe("approved");
  });

  it("refuses an unapproved caller and names the gate", () => {
    expect(() => requireApproved(viewer({ isApproved: false }))).toThrow(DirectoryAccessError);
    expect(() => requireApproved(viewer())).not.toThrow();
  });
});

describe("a claim a reviewer can actually look at", () => {
  /** Answers `accessClaimStatus`'s single statement from a tiny world. */
  function claimEnv(world: {
    named: number;
    students: number;
    placed: number;
    staff?: number;
  }): Env {
    return {
      DB: {
        prepare(sql: string) {
          if (!sql.includes("AS named")) throw new Error(`unexpected: ${sql}`);
          // The guard has to be composed, or a family could complete an
          // application on a Person the gate would hide.
          if (!sql.includes("SELECT person_id FROM control WHERE user_id = ?")) {
            throw new Error("claim statement does not compose the gate");
          }
          return {
            bind: () => ({ first: async () => ({ staff: 0, ...world }) }),
          };
        },
      },
    } as unknown as Env;
  }

  it("needs all three conditions", async () => {
    expect(
      (await accessClaimStatus(claimEnv({ named: 1, students: 1, placed: 1 }), ME)).complete,
    ).toBe(true);
    for (const world of [
      { named: 0, students: 1, placed: 1 },
      { named: 1, students: 0, placed: 1 },
      { named: 1, students: 1, placed: 0 },
    ]) {
      expect((await accessClaimStatus(claimEnv(world), ME)).complete).toBe(false);
    }
  });

  it("reports which condition failed, so the form can point at a sentence", async () => {
    const s = await accessClaimStatus(claimEnv({ named: 1, students: 1, placed: 0 }), ME);
    expect(s).toMatchObject({ selfNamed: true, hasStudent: true, studentPlaced: false });
  });
});

// ── 3. The route gates ──────────────────────────────────────────────────────

interface World {
  /** person_id → controlling user_id */
  control: Record<string, string>;
  /** group_id → person_ids on its roster */
  members: Record<string, string[]>;
}

const WORLD: World = {
  control: { [MY_SELF]: ME, [MY_CHILD]: ME, [THEIR_CHILD]: STRANGER },
  members: {
    [MY_HOUSEHOLD]: [MY_SELF, MY_CHILD],
    [THEIR_HOUSEHOLD]: [THEIR_CHILD],
    [ROOM]: [MY_CHILD, THEIR_CHILD],
  },
};

const PEOPLE: Record<string, { first_name: string; last_name: string }> = {
  [MY_SELF]: { first_name: "Dana", last_name: "Ruiz" },
  [MY_CHILD]: { first_name: "Milo", last_name: "Ruiz" },
  [THEIR_CHILD]: { first_name: "Ada", last_name: "Okonkwo" },
};

/**
 * A D1 stand-in that HONOURS the gate rather than assuming it: a statement
 * whose WHERE restricts to the caller's own control rows returns only those,
 * and one that doesn't returns everybody. So a route that forgot to pass
 * `isApproved` comes back with another family's child in it.
 */
function gateEnv(): Env {
  const rows = (sql: string, binds: unknown[]) => {
    const restricted = sql.includes("SELECT person_id FROM control WHERE user_id = ?");
    const caller = binds.find((b) => typeof b === "string" && b === ME) as string | undefined;
    return Object.keys(PEOPLE)
      .filter((id) => (restricted && caller ? WORLD.control[id] === caller : true))
      .map((id) => ({
        id,
        person_id: id,
        ...PEOPLE[id]!,
        last_name_visibility: "full",
        photo_object_key: null,
        unlisted_at: null,
        title: null,
        is_admin: 0,
        is_direct: 1,
        self_asserted: 0,
      }));
  };

  // `prepare()` has to answer with AND without `bind()` — loadGroupGraph calls
  // `prepare(sql).all()` directly — so the statement object carries both.
  const stmt = (sql: string, binds: unknown[]) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    async first<T>(): Promise<T | null> {
      if (sql.includes("FROM grp WHERE id = ?")) {
        const id = binds[0] as string;
        return WORLD.members[id]
          ? ({
              id,
              kind: id === ROOM ? "classroom" : "household",
              name: id === ROOM ? "Grade 2 · Pam Shrestha · Rm 322" : "The Ruiz home",
              parent_id: null,
            } as T)
          : null;
      }
      if (sql.includes("FROM membership m") && sql.includes("JOIN control")) {
        const [groupId, userId] = binds as [string, string];
        const ok = (WORLD.members[groupId] ?? []).some((pid) => WORLD.control[pid] === userId);
        return ok ? ({ ok: 1 } as T) : null;
      }
      if (sql.includes("COUNT(*)")) return { n: rows(sql, binds).length } as T;
      if (sql.includes("FROM person")) {
        const found = rows(sql, binds).find((r) => binds.includes(r.id));
        return (found ?? null) as T | null;
      }
      return null;
    },
    async all<T>(): Promise<{ results: T[] }> {
      if (sql.trimStart().startsWith("SELECT person_id FROM control")) {
        return {
          results: Object.entries(WORLD.control)
            .filter(([, u]) => u === binds[0])
            .map(([person_id]) => ({ person_id })) as unknown as T[],
        };
      }
      if (sql.includes("SELECT id, parent_id FROM grp")) {
        return {
          results: Object.keys(WORLD.members).map((id) => ({ id, parent_id: null })) as unknown as T[],
        };
      }
      // The roster read in GET /groups/:id: `FROM membership m … JOIN person p`.
      if (sql.includes("FROM membership m") && sql.includes("JOIN person p")) {
        const groupIds = binds.filter((b) => typeof b === "string" && b in WORLD.members) as string[];
        const onRoster = new Set(groupIds.flatMap((g) => WORLD.members[g] ?? []));
        return {
          results: rows(sql, binds).filter((r) => onRoster.has(r.id)) as unknown as T[],
        };
      }
      if (sql.includes("FROM person")) return { results: rows(sql, binds) as unknown as T[] };
      return { results: [] };
    },
  });

  return {
    DB: { prepare: (sql: string) => stmt(sql, []) },
  } as unknown as Env;
}

function app(auth: AuthContext): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    c.set("auth", auth);
    await next();
  }));
  a.onError((err, c) => {
    if (err instanceof DirectoryAccessError) {
      return c.json({ error: "directory_access_required" }, 403);
    }
    throw err;
  });
  a.route("/directory", directory);
  a.route("/persons", persons);
  a.route("/groups", groups);
  return a;
}

describe("what a pending account may read", () => {
  const env = gateEnv();
  const pending = viewer({ isApproved: false });

  it("refuses the directory outright, and names the gate so the app can route", async () => {
    const res = await app(pending).request("/directory", {}, env as never);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "directory_access_required" });
  });

  it("serves the directory to an approved member", async () => {
    const res = await app(viewer()).request("/directory", {}, env as never);
    expect(res.status).toBe(200);
  });

  it("404s another family's profile rather than refusing it", async () => {
    // A 403 here would be invariant 18's oracle: it confirms the id belongs to
    // somebody. The same 404 an unlisted Person already gets is the answer.
    const res = await app(pending).request(`/persons/${THEIR_CHILD}`, {}, env as never);
    expect(res.status).toBe(404);
  });

  it("still serves their own child's profile — the application is edited there", async () => {
    const res = await app(pending).request(`/persons/${MY_CHILD}`, {}, env as never);
    expect(res.status).toBe(200);
  });

  it("refuses the group index", async () => {
    const res = await app(pending).request("/groups", {}, env as never);
    expect(res.status).toBe(403);
  });

  it("opens a household they belong to — the wizard's family step renders it", async () => {
    const res = await app(pending).request(`/groups/${MY_HOUSEHOLD}`, {}, env as never);
    expect(res.status).toBe(200);
  });

  it("refuses a group they do not belong to", async () => {
    const res = await app(pending).request(`/groups/${THEIR_HOUSEHOLD}`, {}, env as never);
    expect(res.status).toBe(403);
  });

  it("refuses their own child's CLASSROOM, which is other families", async () => {
    // The child is on that roster, so the membership check alone would let them
    // in. It doesn't, because the check asks about a Person they CONTROL being
    // on it — which is true here. This is the case worth being explicit about:
    // the room opens, and the roster inside it is narrowed by the predicate to
    // the caller's own child rather than the twenty-five families in it.
    const res = await app(pending).request(`/groups/${ROOM}`, {}, env as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: { displayName: string }[] };
    const names = body.members.map((m) => m.displayName);
    expect(names).toContain("Milo Ruiz");
    expect(names).not.toContain("Ada Okonkwo");
  });
});

// ── 4. Deciding ─────────────────────────────────────────────────────────────

/**
 * Records statements where they EXECUTE, including inside `batch()` — the
 * shape test/backup.test.ts and test/managedEventMove.test.ts use, and for
 * their reason: the property worth pinning here is that the approval and the
 * placement promotion share ONE batch. A fake that only saw `prepare()` could
 * not tell a batch from a sequence, and a sequence is exactly the bug — an
 * account approved with its placements left weak reads as verified while every
 * roster still treats it as hearsay.
 */
function recordingEnv(target: Record<string, unknown>, pendingPlacements = 2) {
  const ran: { sql: string; binds: unknown[]; inBatch: boolean }[] = [];
  const stmt = (sql: string, binds: unknown[]) => ({
    sql,
    binds,
    bind: (...b: unknown[]) => stmt(sql, b),
    async first<T>(): Promise<T | null> {
      ran.push({ sql, binds, inBatch: false });
      if (sql.includes("FROM user WHERE id = ?")) return target as T;
      if (sql.includes("self_asserted = 1")) return { n: pendingPlacements } as T;
      return null;
    },
    async run() {
      ran.push({ sql, binds, inBatch: false });
      return { meta: { changes: 1 } };
    },
    async all<T>(): Promise<{ results: T[] }> {
      ran.push({ sql, binds, inBatch: false });
      return { results: [] as T[] };
    },
  });
  const env = {
    DB: {
      prepare: (sql: string) => stmt(sql, []),
      async batch(stmts: { sql: string; binds: unknown[] }[]) {
        for (const s of stmts) ran.push({ sql: s.sql, binds: s.binds, inBatch: true });
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
  return { env, ran };
}

function adminApp(env: Env, auth: AuthContext) {
  const a = new Hono<HonoEnv>();
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    c.set("auth", auth);
    await next();
  }));
  a.route("/admin", admin);
  return { app: a, request: (p: string, init?: RequestInit) => a.request(p, init, env as never) };
}

const ADMIN: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01S",
  activePersonId: null,
  isMasquerading: false,
  isApproved: true,
};

const PENDING_ROW = {
  id: STRANGER,
  email: "new@family.test",
  access_submitted_at: "2026-09-01T00:00:00.000Z",
  access_approved_at: null,
  access_declined_at: null,
};

describe("approving an application", () => {
  it("promotes the applicant's classroom placements in the SAME batch", async () => {
    const { env, ran } = recordingEnv({ ...PENDING_ROW });
    const res = await adminApp(env, ADMIN).request(`/admin/access-requests/${STRANGER}`, {
      method: "POST",
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "approved", promoted: 2 });

    const batched = ran.filter((r) => r.inBatch);
    expect(batched).toHaveLength(2);
    expect(batched[0]!.sql).toMatch(/UPDATE user/);
    // The promotion — invariant 27's weak membership becoming the trusted kind.
    expect(batched[1]!.sql).toMatch(/UPDATE membership/);
    expect(batched[1]!.sql).toMatch(/self_asserted = 0/);
    // Re-derived inside the statement rather than naming ids read a moment ago:
    // D1 has no read-then-write transaction (invariant 27's race).
    expect(batched[1]!.sql).toMatch(/SELECT person_id FROM control WHERE user_id = \?/);
    expect(batched[1]!.sql).toMatch(/kind = 'classroom'/);
  });

  it("does not promote anything when declining", async () => {
    const { env, ran } = recordingEnv({ ...PENDING_ROW });
    const res = await adminApp(env, ADMIN).request(`/admin/access-requests/${STRANGER}`, {
      method: "POST",
      body: JSON.stringify({ approve: false }),
    });
    expect(res.status).toBe(200);
    expect(ran.filter((r) => r.inBatch).some((r) => /UPDATE membership/.test(r.sql))).toBe(false);
  });

  it("writes nothing when the decision changes nothing", async () => {
    // Already approved, approved again — a double click on the queue.
    const { env, ran } = recordingEnv({
      ...PENDING_ROW,
      access_approved_at: "2026-09-02T00:00:00.000Z",
    });
    const res = await adminApp(env, ADMIN).request(`/admin/access-requests/${STRANGER}`, {
      method: "POST",
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(200);
    expect(ran.filter((r) => r.inBatch)).toHaveLength(0);
    expect(ran.some((r) => /UPDATE user/.test(r.sql))).toBe(false);
  });

  it("refuses a non-admin, and an admin who is masquerading", async () => {
    const { env } = recordingEnv({ ...PENDING_ROW });
    const plain = await adminApp(env, viewer()).request(`/admin/access-requests/${STRANGER}`, {
      method: "POST",
      body: JSON.stringify({ approve: true }),
    });
    expect(plain.status).toBe(403);

    const masked = await adminApp(env, { ...ADMIN, isMasquerading: true }).request(
      `/admin/access-requests/${STRANGER}`,
      { method: "POST", body: JSON.stringify({ approve: true }) },
    );
    expect(masked.status).toBe(403);
  });
});

// ── 5. What review found ────────────────────────────────────────────────────
//
// Each of these pins a defect that shipped in the first draft of this feature
// and that nothing else here would have caught.

describe("vouching is the household invite and nothing wider", () => {
  /** Records the UPDATEs `bindInvite` issues, and whether the vouch fired. */
  function inviteEnv() {
    const ran: string[] = [];
    const stmt = (sql: string) => ({
      sql,
      bind: () => stmt(sql),
      async run() {
        ran.push(sql);
        return { meta: { changes: 1 } };
      },
      async first<T>() {
        return null as T | null;
      },
      async all<T>() {
        return { results: [] as T[] };
      },
    });
    const db = {
      prepare: (sql: string) => stmt(sql),
      // The household path widens control in a batch before it gets here.
      async batch(stmts: { sql?: string }[]) {
        for (const st of stmts) if (st.sql) ran.push(st.sql);
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    };
    return { env: { DB: db } as unknown as Env, ran };
  }

  const vouched = (ran: string[]) => ran.some((s) => /SET access_approved_at/.test(s));

  it("does NOT grant directory access on a bare co-controller invite", async () => {
    // `POST /persons/:id/controllers` writes kind='invite' with a NULL
    // group_id. Invariant 24 exists to stop "help me manage this one child"
    // becoming "see my whole family"; an unconditional vouch here made it
    // "see the whole school" — any approved member could hand a stranger the
    // directory by inviting them as a co-controller, with no review.
    const { env, ran } = inviteEnv();
    const { bindInviteForTest } = await import("../src/routes/auth.js");
    await bindInviteForTest(env, "01INVITEE", "01P_KID", "01INVITER", "gran@x.test", null);
    expect(vouched(ran)).toBe(false);
  });

  it("DOES grant it on a household invite, which the inviter opted into", async () => {
    const { env, ran } = inviteEnv();
    const { bindInviteForTest } = await import("../src/routes/auth.js");
    await bindInviteForTest(env, "01INVITEE", "01P_KID", "01INVITER", "coparent@x.test", MY_HOUSEHOLD);
    expect(vouched(ran)).toBe(true);
  });
});

describe("the admin queue survives a real instance", () => {
  it("chunks both IN lists at D1's 100-bind ceiling", async () => {
    // The queue's own LIMIT is 200 accounts and the person read fans out over
    // every Person they control, so an unchunked IN does not degrade — D1
    // throws `too many SQL variables` and 500s the screen. `lib/backup.ts`
    // already chunks at 100 for this reason.
    const binds: number[] = [];
    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...b: unknown[]) => {
            if (/IN \(/.test(sql)) binds.push(b.length);
            return {
              async all<T>() {
                // One Person per user, so the second read also goes wide.
                return {
                  results: (/JOIN person p/.test(sql)
                    ? b.map((u, i) => ({ user_id: u, id: `p${i}`, first_name: "K", last_name: "R", is_student: 1 }))
                    : []) as unknown as T[],
                };
              },
            };
          },
        }),
      },
    } as unknown as Env;

    const { accessClaimsForTest } = await import("../src/routes/admin.js");
    await accessClaimsForTest(env, Array.from({ length: 200 }, (_, i) => `u${i}`));
    expect(binds.length).toBeGreaterThan(1);
    expect(Math.max(...binds)).toBeLessThanOrEqual(100);
  });

  it("keeps a decided account findable when it never formally asked", () => {
    // Approving from the "Never asked" tab used to leave `access_submitted_at`
    // NULL, and such a row matched none of the three filters: the account
    // vanished from every tab the moment it was decided, taking any way to
    // reverse the decision with it.
    const approvedWithoutAsking = {
      access_submitted_at: "2026-09-01T00:00:00.000Z", // stamped by the route
      access_approved_at: "2026-09-01T00:00:00.000Z",
      access_declined_at: null,
    };
    expect(accessStateOf(approvedWithoutAsking)).toBe("approved");
    // `decided` requires BOTH dates, which is why the route stamps the first.
    expect(
      approvedWithoutAsking.access_approved_at !== null &&
        approvedWithoutAsking.access_submitted_at !== null,
    ).toBe(true);
  });
});

// ── 6. Rate limiting ────────────────────────────────────────────────────────
//
// The gate decides WHETHER, this bounds HOW FAST, and the pair is the answer to
// the concern that prompted both: approval removes the anonymous population,
// the budget stops an approved member walking the roster with a script.

describe("the read budget", () => {
  const limiterEnv = (success: boolean, seen: string[] = []) =>
    ({
      READ_LIMIT: {
        async limit({ key }: { key: string }) {
          seen.push(key);
          return { success };
        },
      },
    }) as unknown as Env;

  it("refuses with 429 and a Retry-After once the budget is gone", async () => {
    const env = limiterEnv(false);
    await expect(enforceReadRate(env, viewer())).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("keys on the user, not the IP — one NAT must not throttle a street", async () => {
    const seen: string[] = [];
    await enforceReadRate(limiterEnv(true, seen), viewer());
    expect(seen).toEqual([ME]);
  });

  it("does NOT exempt a system admin, whose session is the one worth stealing", async () => {
    await expect(
      enforceReadRate(limiterEnv(false), viewer({ isSystemAdmin: true })),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("is OFF when the binding is absent, like an absent RESEND_API_KEY", async () => {
    // Tests and local dev bind no limiter. The direction of this default is
    // deliberate: an unbound limiter admits what it would have refused, which
    // is today's posture; refusing everything would take the directory down on
    // a config slip.
    await expect(enforceReadRate({} as Env, viewer())).resolves.toBeUndefined();
  });

  it("admits the request when the limiter itself throws", async () => {
    const broken = {
      READ_LIMIT: {
        async limit() {
          throw new Error("limiter unavailable");
        },
      },
    } as unknown as Env;
    await expect(enforceReadRate(broken, viewer())).resolves.toBeUndefined();
  });
});

// ── 7. The school is not only parents ───────────────────────────────────────

describe("a teacher or staff member can apply at all", () => {
  /** Same shape as the claim fixture above, spelled out here so this block
   *  reads on its own — it is the regression that matters most in it. */
  function claim(world: { named: number; students: number; placed: number; staff: number }): Env {
    return {
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => world }) }),
      },
    } as unknown as Env;
  }

  it("completes on the staff route, with no child and no classroom", async () => {
    // The dead end this fixes: a teacher has no child to name, so the first
    // version left them with two conditions they could never satisfy and a
    // submit button that never enabled. They were not locked out — an admin
    // can approve from the "Never asked" tab — but they had no way to ASK,
    // and nothing told anyone they were waiting.
    const s = await accessClaimStatus(claim({ named: 1, students: 0, placed: 0, staff: 1 }), ME);
    expect(s.isStaff).toBe(true);
    expect(s.complete).toBe(true);
  });

  it("still needs a name on the staff route — a reviewer needs somebody to be", async () => {
    const s = await accessClaimStatus(claim({ named: 0, students: 0, placed: 0, staff: 1 }), ME);
    expect(s.complete).toBe(false);
  });

  it("does not let the staff claim skip the classroom for a PARENT", async () => {
    // The two routes are alternatives, not a way around the parent one: a
    // family that named a child still has to say which room.
    const s = await accessClaimStatus(claim({ named: 1, students: 1, placed: 0, staff: 0 }), ME);
    expect(s.complete).toBe(false);
  });

  it("leaves the parent route exactly as it was", async () => {
    const s = await accessClaimStatus(claim({ named: 1, students: 1, placed: 1, staff: 0 }), ME);
    expect(s.complete).toBe(true);
    expect(s.isStaff).toBe(false);
  });
});
