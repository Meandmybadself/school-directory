// "Is this account on the roster of the group a setting names?" — the one gate
// two features share.
//
// The PTO's planning boards asked it first (`ptoAccess`, invariant 28); the
// newsletter's authoring side asks it now (`newsletterAccess`, invariant 31).
// Both name their group through a `setting` row rather than a new `grp.kind`,
// because "which group is the PTO board" and "which group writes the
// newsletter" are instance configuration in the same sense `registration_open`
// is, and the group itself is an ordinary `generic` group created and rostered
// with the tools that already exist. There is no second membership model.
//
// It lives here rather than in either feature's lib because the clause worth
// defending — `self_asserted = 0` — is the kind of thing a second copy forgets.

import type { AuthContext, Env } from "../env.js";
import { getSetting } from "./db.js";

/** What a roster gate answers. `PtoAccessDTO` and `NewsletterAccessDTO` in
 *  `@sd/shared` are this shape, spelled once per feature so each can document
 *  what its fields mean to its own client. */
export interface RosterAccess {
  canUse: boolean;
  isSystemAdmin: boolean;
  groupName: string | null;
  groupId: string | null;
}

/**
 * May this caller use the feature, and which group decides?
 *
 * A system admin is always in — being one is a fact about the account, not
 * something a roster decides, the same short-circuit `personListableSql` makes.
 *
 * Everyone else is in iff some Person they control sits on the configured
 * group's roster with **`self_asserted = 0`**. That last clause is the one worth
 * defending. Migration 0023 added the column precisely to separate being ON a
 * list from being TRUSTED by it: `PUT /persons/:id/classroom` lets a parent put
 * their own child on a roster with no authority over it, and while only
 * classrooms can be self-asserted today, a gate that ignored the column would
 * silently become wrong the day that door widens. Every row
 * `POST /groups/:id/members` writes — the only way into a generic group, and it
 * is behind `requireGroupAdmin` — has `self_asserted = 0`, so honouring it costs
 * this gate nothing today and cannot be forgotten later.
 *
 * With no group configured, only system admins are admitted. That is the correct
 * bootstrap rather than a hole: an admin creates the group in apps/web, and
 * names it in the feature's own settings.
 *
 * Note what this does NOT do: it does not read `person`. Membership and control
 * are the whole question, and applying the enumeration gate here would be the
 * wrong predicate — an unlisted PTO board member is still on the PTO board, and
 * an unlisted newsletter editor still writes the newsletter. The gate belongs
 * on what their NAME does, which is `ptoRosterOf`'s job.
 */
export async function rosterAccess(
  env: Env,
  settingKey: string,
  auth: AuthContext,
): Promise<RosterAccess> {
  const groupId = await getSetting(env, settingKey);
  const group = groupId
    ? await env.DB.prepare("SELECT id, name FROM grp WHERE id = ?")
        .bind(groupId)
        .first<{ id: string; name: string }>()
    : null;

  if (auth.isSystemAdmin) {
    return {
      canUse: true,
      isSystemAdmin: true,
      groupName: group?.name ?? null,
      groupId: group?.id ?? null,
    };
  }

  const row = group
    ? await env.DB.prepare(
        `SELECT 1 AS ok
           FROM membership m
           JOIN control c ON c.person_id = m.person_id
          WHERE m.group_id = ? AND m.self_asserted = 0 AND c.user_id = ?
          LIMIT 1`,
      )
        .bind(group.id, auth.userId)
        .first<{ ok: number }>()
    : null;

  return {
    canUse: !!row,
    isSystemAdmin: false,
    groupName: group?.name ?? null,
    groupId: group?.id ?? null,
  };
}

/** The gate as a boolean, for a route that only needs the answer. A system
 *  admin is admitted without a read — the routes that call this per request
 *  were free for an admin before the gate existed and stay so. */
export async function rosterAdmits(env: Env, settingKey: string, auth: AuthContext): Promise<boolean> {
  if (auth.isSystemAdmin) return true;
  return (await rosterAccess(env, settingKey, auth)).canUse;
}

/** The groups a system admin may name here: `generic` only. A household or a
 *  classroom is a different kind of thing and shouldn't double as a committee. */
export async function genericGroups(env: Env): Promise<{ id: string; name: string; memberCount: number }[]> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.name,
            (SELECT COUNT(*) FROM membership m WHERE m.group_id = g.id) AS member_count
       FROM grp g WHERE g.kind = 'generic' ORDER BY lower(g.name)`,
  ).all<{ id: string; name: string; member_count: number }>();
  return rows.results.map((r) => ({ id: r.id, name: r.name, memberCount: r.member_count }));
}

/** Validate a group id a system admin is about to store, or "" to clear. A
 *  missing group is refused rather than stored: a setting pointing at nothing
 *  would read as "configured" while admitting nobody. */
export async function groupExists(env: Env, groupId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM grp WHERE id = ?")
    .bind(groupId)
    .first<{ id: string }>();
  return !!row;
}
