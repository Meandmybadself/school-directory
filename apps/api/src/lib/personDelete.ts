// The row-level cascade for removing one Person, factored out so the two places
// that delete a Person — `DELETE /persons/:id` (invariant 25) and a user
// deletion that orphans a Person (invariant 17) — run the SAME statements in the
// SAME order and can't drift.
//
// It returns the Person's OWN rows only, children-first, ending with the person
// row itself (the ordering `sheetCascade` takes, invariant 13: a foreign key
// left dangling is a row invisible to every read). It deliberately does NOT
// include the "emptied household" cleanup: whether a household is left empty
// depends on which OTHER Persons are going in the same operation, which only the
// caller knows — one Person for the person route, a whole set for a user delete.

import type { Env } from "../env.js";

/** Prepared DELETEs for one Person's own rows, in cascade order. The caller
 *  batches these (and any emptied-household cleanup it computes) together. */
export function personCascadeStmts(env: Env, personId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM volunteer_signup WHERE person_id = ?").bind(personId),
    // Shares in both directions. As SUBJECT, a share names either a contact item
    // of theirs or the synthetic `person:{id}:last_name` field ref; as TARGET, it
    // is someone else's field shared WITH them, which stops meaning anything the
    // moment they are gone.
    env.DB.prepare(
      `DELETE FROM share WHERE (subject_kind = 'contact_item' AND subject_ref IN
         (SELECT id FROM contact_item WHERE owner_kind = 'person' AND owner_id = ?))
         OR (subject_kind = 'field' AND subject_ref LIKE ?)
         OR (target_kind = 'person' AND target_id = ?)`,
    ).bind(personId, `person:${personId}:%`, personId),
    env.DB.prepare("DELETE FROM contact_item WHERE owner_kind = 'person' AND owner_id = ?").bind(personId),
    env.DB.prepare("DELETE FROM capability_grant WHERE person_id = ?").bind(personId),
    env.DB.prepare("DELETE FROM membership WHERE person_id = ?").bind(personId),
    env.DB.prepare("DELETE FROM control WHERE person_id = ?").bind(personId),
    // Invitations to co-manage them, and the tokens that would bind them. An
    // unconsumed invite left behind is a live capability pointing at a row that
    // no longer exists — /auth/callback would create a user for it and then grant
    // control of nothing.
    env.DB.prepare("DELETE FROM control_invite WHERE person_id = ?").bind(personId),
    env.DB.prepare("DELETE FROM auth_token WHERE person_id = ?").bind(personId),
    env.DB.prepare("DELETE FROM person WHERE id = ?").bind(personId),
  ];
}
