// Reading the directory is granted, not conferred by signing up (migration
// 0029, invariant 32). This file is the whole of that decision: what a complete
// application looks like, what state an account is in, and the guard the gated
// routes call.
//
// WHY AN APPLICATION AND NOT AN ALLOWLIST. An allowlist judges an email
// address, which asserts nothing and can be checked against nothing short of
// the district's own family roster — and asking for that roster would put
// education records in this system, which today holds none. An application
// judges what the applicant TYPED: their name, their child's name, and the room
// that child is in, chosen from the classroom groups this instance already
// carries under the district's own names. A reviewer checks that in seconds.
//
// WHAT APPROVAL IS NOT. It is not proof of anything. A determined person can
// type a plausible room. What it removes is the ANONYMOUS population: every
// reader of the directory has told us a child's name and a teacher, and that is
// attribution. Rate limiting is the other half and is a separate mechanism.

import type { AccessClaimStatusDTO, DirectoryAccessState } from "@sd/shared";
import type { AuthContext, Env } from "../env.js";
import { personListableSql } from "./privacy.js";

/** The dates the state is derived from. Never stored as a word: `approved` and
 *  `declined` are both dates, and a stored label could disagree with them. */
export interface AccessRow {
  access_submitted_at: string | null;
  access_approved_at: string | null;
  access_declined_at: string | null;
}

/**
 * Approval wins over a decline, so re-approving a declined account is a plain
 * UPDATE of `access_approved_at` rather than a two-column dance — and a
 * reviewer who declined by mistake fixes it with the button they already have.
 */
export function accessStateOf(row: AccessRow, isSystemAdmin = false): DirectoryAccessState {
  if (isSystemAdmin || row.access_approved_at) return "approved";
  if (row.access_declined_at) return "declined";
  if (row.access_submitted_at) return "pending";
  return "incomplete";
}

/**
 * Is there a claim here worth reviewing?
 *
 * Three questions, each one a sentence the form can point at when the button is
 * disabled. They are deliberately about SHAPE rather than truth — nothing here
 * can tell whether the child is real, and pretending otherwise would be the
 * allowlist's mistake in a new place. What they guarantee is that a reviewer is
 * given something to look at.
 *
 * `studentPlaced` accepts a `self_asserted = 1` membership, which is the only
 * kind a parent can create for their own child (invariant 27) — the whole point
 * is that they tell us the room and somebody then decides whether to believe
 * it. Approval is what promotes that row to trusted.
 *
 * Reads `person` only through `control`, so which Persons exist to this caller
 * was already settled by the join: the applicant's own. It spends none of
 * test/personListable.test.ts's exemption budget.
 */
export async function accessClaimStatus(env: Env, userId: string): Promise<AccessClaimStatusDTO> {
  // Composed rather than exempted, and not the ceremony it looks like: the
  // caller is by definition NOT a system admin here (an admin is approved and
  // never sees this form), so the predicate is the real two-branch one rather
  // than the literal "1" invariant 22 warns reads like a guard. For the
  // applicant's own family the control disjunct is what admits every row —
  // including an unlisted child of their own, who must still make the
  // application complete.
  const listable = personListableSql(userId, false, "p");
  // ALL-ANONYMOUS binds, deliberately. An earlier version used `?1` for the
  // three `user_id` terms and let `personListableSql` contribute an anonymous
  // `?`; SQLite numbers a bare `?` as one past the highest index so far, so it
  // worked only because both values happened to be `userId`. The day that
  // helper emits a second bind, or a different one, every position after it
  // shifts and this silently counts the wrong rows — and a fake D1 that
  // ignores binds cannot see it. One style per statement, like the rest of the
  // API.
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM control c
          JOIN person p ON p.id = c.person_id
         WHERE c.user_id = ?
           AND ${listable.sql}
           AND trim(coalesce(p.first_name,'')) <> ''
           AND trim(coalesce(p.last_name,'')) <> '') AS named,
       (SELECT COUNT(*) FROM control c
          JOIN capability_grant g ON g.person_id = c.person_id AND g.capability = 'student'
         WHERE c.user_id = ?) AS students,
       (SELECT COUNT(*) FROM control c
          JOIN capability_grant g ON g.person_id = c.person_id AND g.capability = 'student'
          JOIN membership m ON m.person_id = c.person_id
          JOIN grp gr ON gr.id = m.group_id AND gr.kind = 'classroom'
         WHERE c.user_id = ?) AS placed`,
  )
    .bind(userId, ...listable.binds, userId, userId)
    .first<{ named: number; students: number; placed: number }>();

  const selfNamed = (row?.named ?? 0) > 0;
  const hasStudent = (row?.students ?? 0) > 0;
  const studentPlaced = (row?.placed ?? 0) > 0;
  return {
    selfNamed,
    hasStudent,
    studentPlaced,
    complete: selfNamed && hasStudent && studentPlaced,
  };
}

/** One account's access row. Its own read because `GET /me` needs the two
 *  dates the session join deliberately doesn't carry — the session wants a
 *  boolean, this wants to explain itself. */
export async function accessRowOf(env: Env, userId: string): Promise<AccessRow> {
  const row = await env.DB.prepare(
    "SELECT access_submitted_at, access_approved_at, access_declined_at FROM user WHERE id = ?",
  )
    .bind(userId)
    .first<AccessRow>();
  return (
    row ?? { access_submitted_at: null, access_approved_at: null, access_declined_at: null }
  );
}

/** Thrown by `requireApproved`, turned into a 403 by the app's onError. The
 *  body names the gate so a client can route to the application screen rather
 *  than showing a generic failure — it discloses nothing, since the caller is
 *  authenticated and is being told about their own account. */
export class DirectoryAccessError extends Error {
  constructor() {
    super("directory_access_required");
  }
}

/**
 * The guard for a route that serves one family's data to another.
 *
 * Deliberately a function called at the top of a handler rather than a
 * middleware mounted on a path: the routes needing it are not a path prefix —
 * `GET /groups/:id` must still serve a household the caller belongs to, and
 * `GET /persons/:id` must still serve their own children — so a prefix mount
 * would either lock a pending member out of their own family or, worse, look
 * like it covered routes it never ran on.
 */
export function requireApproved(auth: AuthContext): void {
  if (!auth.isApproved) throw new DirectoryAccessError();
}
