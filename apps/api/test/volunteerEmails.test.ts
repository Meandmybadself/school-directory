// "Email volunteers" — which address is chosen, and which is not.
//
// Behavioural, like test/ptoAccess.test.ts and for the same reason: the two
// rules that matter here are both spelled as a WHERE clause, and a source scan
// can see that a clause is present without ever proving it excludes anything.
// So the fake D1 below EVALUATES them — a statement that dropped
// `visibility = 'service'` comes back with a private address in the list, and
// one that dropped `disabled_at IS NULL` mails an account that can no longer
// sign in. Both show up as a failing expectation naming the leaked address.
//
// Four properties:
//
//   1. One address per volunteer, in sheet order, deduped across families —
//      two children of one parent are one Bcc line, not two.
//   2. A Person's own `service` email wins; their controller's account email is
//      the fallback, which is how a child is reachable at all.
//   3. A `private` contact item is never read. `canSeeItem` grants a system
//      admin no exemption from it, and this route does not invent one.
//   4. A volunteer with no address is COUNTED, not silently dropped.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.js";
import { sheetVolunteerEmails } from "../src/lib/volunteers.js";

const SHEET = "01SHEET";

interface SignupRow {
  person_id: string;
  /** Position sort order, then signup order — how the admin reads the sheet. */
  sort_order: number;
  created_at: string;
}

interface ContactRow {
  owner_id: string;
  type: string;
  value: string;
  visibility: "service" | "private";
  sort_order: number;
}

interface ControlRow {
  person_id: string;
  user_id: string;
  email: string;
  since: string;
  disabled: boolean;
}

interface World {
  sheets: string[];
  signups: SignupRow[];
  contacts: ContactRow[];
  controls: ControlRow[];
}

/** The two clauses this seam relies on, matched as PREDICATES rather than as
 *  the presence of a call — see the header. */
const SERVICE_ONLY = /visibility = 'service'/;
const ENABLED_ONLY = /disabled_at IS NULL/;

/** A D1 stand-in that answers the four statements `sheetVolunteerEmails` issues
 *  and throws on anything else, in the "narrow on purpose" style the fakes in
 *  newsletterSubscribe.test.ts and ptoAccess.test.ts use. */
function fakeEnv(world: World): Env {
  const db = {
    prepare(sql: string) {
      const run = (binds: unknown[]) => ({
        async first<T>(): Promise<T | null> {
          if (sql.includes("FROM volunteer_sheet")) {
            const id = binds[0] as string;
            return world.sheets.includes(id) ? ({ id } as unknown as T) : null;
          }
          throw new Error(`unexpected first(): ${sql}`);
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes("FROM volunteer_signup")) {
            const rows = world.signups
              .filter(() => binds[0] === SHEET)
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
            return { results: rows.map((r) => ({ person_id: r.person_id })) as T[] };
          }
          if (sql.includes("FROM contact_item")) {
            const ids = binds as string[];
            const rows = world.contacts
              .filter((r) => ids.includes(r.owner_id) && r.type === "email")
              // The clause under test. Without it in the SQL, a private address
              // reaches the caller — which is the failure this evaluates for.
              .filter((r) => (SERVICE_ONLY.test(sql) ? r.visibility === "service" : true))
              .slice()
              .sort((a, b) => a.sort_order - b.sort_order);
            return { results: rows.map((r) => ({ person_id: r.owner_id, email: r.value })) as T[] };
          }
          if (sql.includes("FROM control")) {
            const ids = binds as string[];
            const rows = world.controls
              .filter((r) => ids.includes(r.person_id))
              .filter((r) => (ENABLED_ONLY.test(sql) ? !r.disabled : true))
              .slice()
              .sort((a, b) => a.since.localeCompare(b.since) || a.user_id.localeCompare(b.user_id));
            return { results: rows.map((r) => ({ person_id: r.person_id, email: r.email })) as T[] };
          }
          throw new Error(`unexpected all(): ${sql}`);
        },
      });
      return {
        bind: (...binds: unknown[]) => run(binds),
        ...run([]),
      };
    },
  };
  return { DB: db } as unknown as Env;
}

/** Dana volunteers herself and both her children; Sam volunteers alone; Kai's
 *  household has nobody who can sign in. */
function world(): World {
  return {
    sheets: [SHEET],
    signups: [
      { person_id: "01DANA", sort_order: 0, created_at: "2026-10-01T10:00:00.000Z" },
      { person_id: "01KID_A", sort_order: 0, created_at: "2026-10-01T11:00:00.000Z" },
      { person_id: "01SAM", sort_order: 1, created_at: "2026-10-01T09:00:00.000Z" },
      { person_id: "01KID_B", sort_order: 2, created_at: "2026-10-02T09:00:00.000Z" },
      { person_id: "01KAI", sort_order: 2, created_at: "2026-10-02T10:00:00.000Z" },
      // The same person on a second position — one address, not two.
      { person_id: "01DANA", sort_order: 2, created_at: "2026-10-02T11:00:00.000Z" },
    ],
    contacts: [
      { owner_id: "01DANA", type: "email", value: "dana@example.com", visibility: "service", sort_order: 0 },
      { owner_id: "01DANA", type: "email", value: "dana-work@example.com", visibility: "service", sort_order: 1 },
      // Sam published nothing; only their account email should be reachable.
      { owner_id: "01SAM", type: "email", value: "sam-private@example.com", visibility: "private", sort_order: 0 },
    ],
    controls: [
      { person_id: "01DANA", user_id: "01U_DANA", email: "dana-account@example.com", since: "2026-01-01", disabled: false },
      { person_id: "01KID_A", user_id: "01U_DANA", email: "dana-account@example.com", since: "2026-01-01", disabled: false },
      { person_id: "01KID_B", user_id: "01U_DANA", email: "dana-account@example.com", since: "2026-02-01", disabled: false },
      // Two parents on one child: the longer-standing controller is "the first".
      { person_id: "01KID_B", user_id: "01U_PAT", email: "pat@example.com", since: "2026-01-15", disabled: false },
      { person_id: "01SAM", user_id: "01U_SAM", email: "sam@example.com", since: "2026-03-01", disabled: false },
      // Kai's only controller can no longer sign in.
      { person_id: "01KAI", user_id: "01U_GONE", email: "gone@example.com", since: "2026-01-01", disabled: true },
    ],
  };
}

describe("sheetVolunteerEmails", () => {
  it("gives one address per volunteer, in sheet order, deduped", async () => {
    const r = await sheetVolunteerEmails(fakeEnv(world()), SHEET);
    expect(r).not.toBeNull();
    expect(r!.emails).toEqual([
      // Dana's own published address, not her account's — and once, though she
      // took two spots.
      "dana@example.com",
      // Her child has no address of their own, so the parent's account is used;
      // it is a different string from the line above, and both are hers.
      "dana-account@example.com",
      "sam@example.com",
      // 01KID_B's longer-standing controller.
      "pat@example.com",
    ]);
  });

  it("never reads a private contact item", async () => {
    // Sam's private address is the one a spread-shaped implementation would
    // pick up; `canSeeItem` gives a system admin no exemption from `private`,
    // so neither does this.
    const r = await sheetVolunteerEmails(fakeEnv(world()), SHEET);
    expect(r!.emails).not.toContain("sam-private@example.com");
    expect(JSON.stringify(r)).not.toContain("private@example.com");
  });

  it("skips a disabled account and counts the volunteer as unreachable", async () => {
    // Mail to an account that cannot sign in is mail to nobody — the newsletter
    // audience makes the same exclusion. The admin is TOLD rather than left to
    // assume the Bcc line is everyone.
    const r = await sheetVolunteerEmails(fakeEnv(world()), SHEET);
    expect(r!.emails).not.toContain("gone@example.com");
    expect(r!.withoutEmail).toBe(1);
  });

  it("prefers the first published address over the second", async () => {
    const r = await sheetVolunteerEmails(fakeEnv(world()), SHEET);
    expect(r!.emails).not.toContain("dana-work@example.com");
  });

  it("answers an empty sheet without pretending it failed", async () => {
    const w = world();
    w.signups = [];
    expect(await sheetVolunteerEmails(fakeEnv(w), SHEET)).toEqual({ emails: [], withoutEmail: 0 });
  });

  it("is null for a sheet that does not exist", async () => {
    expect(await sheetVolunteerEmails(fakeEnv(world()), "01NOPE")).toBeNull();
  });
});
