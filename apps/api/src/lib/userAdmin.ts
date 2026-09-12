// Permanent user deletion (invariant 17), and the impact report it executes.
//
// Invariant 17 said this was "deliberately not implemented" and that the impact
// route was "the only statement of what it would be allowed to touch, and if it
// is ever built it must execute that report rather than re-derive it." This is
// that build: `computeUserDeletionImpact` is the report, used BOTH by
// `GET /admin/users/:id/impact` (to show it) and by the DELETE (to execute it),
// so the two cannot disagree about what goes.
//
// The obvious reading of "delete a user and everything they made" is wrong, and
// the report encodes why:
//   - `control` is many-to-many (two parents, one child): only a Person left
//     with NO other controller is this user's to remove; a co-controlled one
//     keeps its row and loses only this user's control.
//   - `grp` records no creator, so a classroom or generic group is the school's,
//     never a member's — it survives, even when this was its only admin.
//   - `audit_log` is append-only and hash-chained (invariant 5) and never
//     touched — it is deliberately absent below.
//
// D1 does not enforce foreign keys, so nothing here is protected by the schema:
// a reference left pointing at the deleted row would simply dangle, invisible to
// reads (the invariant-13 failure mode). So user-scoped rows are cleaned by
// hand — deleted where they are the account's alone (its sessions, sign-in
// tokens, volunteer claims, board comments), and NULLed where they merely
// attribute a surviving record to the account (created_by, assigned_by, an
// order's buyer link).

import type { GroupKind, UserDeletionImpactDTO } from "@sd/shared";
import type { Env } from "../env.js";
import { personCascadeStmts } from "./personDelete.js";

export interface UserRow {
  id: string;
  email: string;
  disabled_at: string | null;
}

/** Read the report of what deleting this user would remove and keep. READ ONLY.
 *  Returns null when the user does not exist. */
export async function computeUserDeletionImpact(
  env: Env,
  userId: string,
): Promise<UserDeletionImpactDTO | null> {
  const user = await env.DB.prepare("SELECT id, email, disabled_at FROM user WHERE id = ?")
    .bind(userId)
    .first<UserRow>();
  if (!user) return null;

  // Every Person they control, with how many OTHER users also control them.
  const people = await env.DB.prepare(
    `SELECT p.id, p.first_name, p.last_name,
            (SELECT COUNT(*) FROM control c2 WHERE c2.person_id = p.id AND c2.user_id <> ?) AS others
       FROM control c
       JOIN person p ON p.id = c.person_id -- UNLISTED-EXEMPT: system-admin route
      WHERE c.user_id = ?
      ORDER BY p.first_name`,
  )
    .bind(userId, userId)
    .all<{ id: string; first_name: string; last_name: string | null; others: number }>();

  const nameOf = (r: { first_name: string; last_name: string | null }) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ");

  const orphanedPersons = people.results
    .filter((r) => r.others === 0)
    .map((r) => ({ id: r.id, name: nameOf(r) }));
  const sharedPersons = people.results
    .filter((r) => r.others > 0)
    .map((r) => ({ id: r.id, name: nameOf(r), otherControllers: r.others }));

  // Households whose every member is among the orphans — nobody would be left in
  // them. A household that still has somebody in it stays, address and all.
  const emptiedHouseholds: { id: string; name: string }[] = [];
  if (orphanedPersons.length > 0) {
    const marks = orphanedPersons.map(() => "?").join(",");
    const ids = orphanedPersons.map((p) => p.id);
    const rows = await env.DB.prepare(
      `SELECT g.id, g.name
         FROM grp g
        WHERE g.kind = 'household'
          AND EXISTS (SELECT 1 FROM membership m
                       WHERE m.group_id = g.id AND m.person_id IN (${marks}))
          AND NOT EXISTS (SELECT 1 FROM membership m2
                           WHERE m2.group_id = g.id AND m2.person_id NOT IN (${marks}))
        ORDER BY g.name`,
    )
      .bind(...ids, ...ids)
      .all<{ id: string; name: string }>();
    emptiedHouseholds.push(...rows.results);
  }

  // Classrooms and generic groups they administer. Reported, never deleted.
  const retained = await env.DB.prepare(
    `SELECT DISTINCT g.id, g.name, g.kind
       FROM membership m
       JOIN grp g ON g.id = m.group_id
       JOIN control c ON c.person_id = m.person_id
      WHERE c.user_id = ? AND m.is_admin = 1 AND g.kind <> 'household'
      ORDER BY g.name`,
  )
    .bind(userId)
    .all<{ id: string; name: string; kind: GroupKind }>();

  const audit = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE actor_user_id = ? OR masquerading_as = ?",
  )
    .bind(userId, userId)
    .first<{ n: number }>();

  // Destructive, account-owned rows nothing else holds — surfaced so the
  // confirmation is honest about them, then deleted by userDeletionStmts.
  const claims = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM volunteer_signup WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ n: number }>();
  const comments = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pto_card_comment WHERE author_user_id = ?",
  )
    .bind(userId)
    .first<{ n: number }>();

  return {
    user: { id: user.id, email: user.email, disabled: user.disabled_at !== null },
    orphanedPersons,
    sharedPersons,
    emptiedHouseholds,
    retainedGroupsAdministered: retained.results,
    auditEntries: audit?.n ?? 0,
    volunteerClaimsWithdrawn: claims?.n ?? 0,
    boardCommentsDeleted: comments?.n ?? 0,
  };
}

/** The batch that executes an impact report. `email` is the account's, used to
 *  clear its sign-in tokens (auth_token is keyed by email, not user id). The
 *  statements run in one `DB.batch`, which SQLite serializes — children before
 *  the rows that point at them, and the `user` row last. `audit_log` is never
 *  in it. */
export function userDeletionStmts(
  env: Env,
  userId: string,
  email: string,
  impact: UserDeletionImpactDTO,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];

  // Orphaned Persons: the full per-Person cascade, shared with DELETE /persons.
  for (const p of impact.orphanedPersons) stmts.push(...personCascadeStmts(env, p.id));

  // Households the orphans emptied — computed across ALL orphans by the report,
  // so a household two of them shared is caught where a per-Person view misses it.
  for (const h of impact.emptiedHouseholds) {
    stmts.push(
      env.DB.prepare("DELETE FROM contact_item WHERE owner_kind = 'group' AND owner_id = ?").bind(h.id),
      env.DB.prepare("DELETE FROM share WHERE target_kind = 'group' AND target_id = ?").bind(h.id),
      env.DB.prepare("DELETE FROM grp WHERE id = ?").bind(h.id),
    );
  }

  // This account's remaining control rows — co-controlled Persons that SURVIVE,
  // losing only this account's control. (Orphans' control went with them above.)
  stmts.push(env.DB.prepare("DELETE FROM control WHERE user_id = ?").bind(userId));

  // Account-owned rows nothing else holds. Deleted rather than NULLed:
  //  - volunteer claims are the account's ("who claimed this spot"),
  //  - board comments are the account's speech,
  //  - sessions include masquerade sessions this admin opened (acting_admin_id),
  //  - sign-in tokens are keyed by the account's email.
  stmts.push(
    env.DB.prepare("DELETE FROM volunteer_signup WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM pto_card_comment WHERE author_user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM session WHERE user_id = ? OR acting_admin_id = ?").bind(userId, userId),
    env.DB.prepare("DELETE FROM auth_token WHERE email = ?").bind(email),
  );

  // Surviving records that merely ATTRIBUTE something to this account: keep the
  // record, drop the pointer, so nothing dangles at a row that is gone. A
  // store_order is a financial record and stays; it just loses its buyer link.
  for (const [table, col] of [
    ["control", "granted_by"],
    ["control_invite", "invited_by"],
    ["managed_calendar", "created_by"],
    ["managed_event", "created_by"],
    ["newsletter_issue", "created_by"],
    ["newsletter_subscriber", "user_id"],
    ["volunteer_sheet", "created_by"],
    ["store_order", "user_id"],
    ["pto_board", "created_by"],
    ["pto_card", "created_by"],
    ["pto_card_assignee", "assigned_by"],
  ] as const) {
    stmts.push(env.DB.prepare(`UPDATE ${table} SET ${col} = NULL WHERE ${col} = ?`).bind(userId));
  }

  // The account itself, last.
  stmts.push(env.DB.prepare("DELETE FROM user WHERE id = ?").bind(userId));

  return stmts;
}
