// Privacy resolution — the single most important server function (SDD §5).
// Given a viewer (the active Person of the requesting User) and a target item,
// decide visibility. Filtering happens here, server-side, before serialization.
// geo_lat/geo_lng are NEVER serialized regardless of permission.

import type { LastNameDisplay, Visibility } from "@sd/shared";
import type { Env } from "../env.js";
import { effectiveGroupIdsForPerson } from "./groupTree.js";

export interface ContactItemRow {
  id: string;
  owner_kind: string;
  owner_id: string;
  type: string;
  label: string | null;
  value: string;
  visibility: Visibility;
  neighbor_discoverable: number;
  geo_lat: number | null;
  geo_lng: number | null;
}

export interface Viewer {
  userId: string;
  /** Active Person id, or null if the user has no active person. */
  personId: string | null;
}

/** User ids that control a Person. */
export async function controllerUserIds(env: Env, personId: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    "SELECT user_id FROM control WHERE person_id = ?",
  )
    .bind(personId)
    .all<{ user_id: string }>();
  return new Set(rows.results.map((r) => r.user_id));
}

export async function isController(
  env: Env,
  userId: string,
  personId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM control WHERE user_id = ? AND person_id = ? LIMIT 1",
  )
    .bind(userId, personId)
    .first<{ ok: number }>();
  return !!row;
}

/** Effective group ids the viewer's active Person belongs to. Membership rolls
 *  UP the hierarchy: a member of a classroom is also an effective member of its
 *  grade and the school, so a private item shared with an ancestor group reaches
 *  descendant members. (With a flat hierarchy this equals direct memberships.) */
export async function viewerGroupIds(env: Env, viewer: Viewer): Promise<Set<string>> {
  if (!viewer.personId) return new Set();
  return effectiveGroupIdsForPerson(env, viewer.personId);
}

/**
 * Resolve whether `viewer` can see `item` owned by `ownerPersonId`.
 * Precomputed sets (controllers, shares, viewer groups) are passed in to avoid
 * per-item round-trips when filtering a whole profile.
 */
export function canSeeItem(args: {
  viewer: Viewer;
  item: ContactItemRow;
  ownerControllerUserIds: Set<string>;
  /** Person/Group ids this specific item is shared with. */
  sharedWithPersonIds: Set<string>;
  sharedWithGroupIds: Set<string>;
  viewerGroups: Set<string>;
}): boolean {
  const { viewer, item, ownerControllerUserIds, sharedWithPersonIds, sharedWithGroupIds, viewerGroups } =
    args;

  // A Controller of the owner always sees everything.
  if (ownerControllerUserIds.has(viewer.userId)) return true;

  // "service" == visible to any authenticated member.
  if (item.visibility === "service") return true;

  // private: only via an explicit share to the viewer's person or one of its groups.
  if (viewer.personId && sharedWithPersonIds.has(viewer.personId)) return true;
  for (const g of viewerGroups) if (sharedWithGroupIds.has(g)) return true;

  return false;
}

/**
 * Apply the last-name display rule AFTER canSee. Controllers see the full name;
 * everyone else gets full/initial/nothing per the Person's setting. The server
 * never returns more than the policy allows.
 */
export function renderLastName(
  lastName: string | null,
  display: LastNameDisplay,
  viewerIsController: boolean,
): string | null {
  if (!lastName) return null;
  if (viewerIsController) return lastName; // owner-side editing sees the real value
  switch (display) {
    case "full":
      return lastName;
    case "initial":
      return lastName.charAt(0) + ".";
  }
}

export function displayName(
  firstName: string,
  lastName: string | null,
  display: LastNameDisplay,
  viewerIsController: boolean,
): string {
  const ln = renderLastName(lastName, display, viewerIsController);
  return ln ? `${firstName} ${ln}` : firstName;
}

/** What one subject is shared with. The shape `canSeeItem` consumes. */
export interface ShareSet {
  persons: Set<string>;
  groups: Set<string>;
  count: number;
}

const EMPTY_SHARES: ShareSet = { persons: new Set(), groups: new Set(), count: 0 };

/**
 * Shares for MANY subjects in one round trip, keyed by subject ref.
 *
 * This replaced a per-subject query, which was fine for one and quietly
 * expensive for a profile: a member with eight contacts plus their household's
 * paid eight sequential D1 round trips before the DTO existed. Same batching the
 * capability lookups next door already do — collect the ids, one `IN (…)`, fan
 * the rows back out. There is deliberately no single-subject variant left to
 * reach for.
 *
 * Missing keys read as "shared with nobody" via `sharesOf`, so a caller never
 * has to distinguish "no shares" from "not in the map".
 */
export async function sharesForMany(
  env: Env,
  subjectKind: "contact_item" | "field",
  subjectRefs: string[],
): Promise<Map<string, ShareSet>> {
  const out = new Map<string, ShareSet>();
  if (!subjectRefs.length) return out;
  const refs = [...new Set(subjectRefs)];
  const rows = await env.DB.prepare(
    `SELECT subject_ref, target_kind, target_id FROM share
      WHERE subject_kind = ? AND subject_ref IN (${refs.map(() => "?").join(",")})`,
  )
    .bind(subjectKind, ...refs)
    .all<{ subject_ref: string; target_kind: string; target_id: string }>();

  for (const r of rows.results) {
    let entry = out.get(r.subject_ref);
    if (!entry) {
      entry = { persons: new Set<string>(), groups: new Set<string>(), count: 0 };
      out.set(r.subject_ref, entry);
    }
    if (r.target_kind === "person") entry.persons.add(r.target_id);
    else if (r.target_kind === "group") entry.groups.add(r.target_id);
    entry.count++;
  }
  return out;
}

/** Read one subject out of a `sharesForMany` map, defaulting to no shares. */
export function sharesOf(map: Map<string, ShareSet>, subjectRef: string): ShareSet {
  return map.get(subjectRef) ?? EMPTY_SHARES;
}


/**
 * Search predicate over `person` that respects the last-name display rule.
 *
 * A naked `lower(last_name) LIKE ?` is an oracle: the response renders a Person
 * set to `initial` as "Dana R.", but matching on the stored surname lets any
 * member confirm it by typing "ruiz" and seeing whether the row comes back — and
 * `COUNT(*)` over the same WHERE leaks it before a row is even built. So the
 * surname term is conjoined with the display rule, with the same controller
 * exemption `renderLastName` grants: you may always search names you own.
 *
 * First names carry no display rule, so they match unconditionally. The initial
 * itself is public, and a single letter matches through the first-name term
 * anyway, so nothing a member can already see becomes harder to find.
 *
 * Returns a parenthesised boolean expression safe to AND into any WHERE over
 * `person`, plus its binds. An empty query matches everything ("1"), which is
 * what every call site wants for an unfiltered list.
 */
export function personSearchSql(
  q: string,
  viewerUserId: string,
): { sql: string; binds: unknown[] } {
  if (!q) return { sql: "1", binds: [] };
  const like = `%${q}%`;
  return {
    sql:
      `(lower(first_name) LIKE ?` +
      ` OR (lower(coalesce(last_name,'')) LIKE ?` +
      `     AND (last_name_visibility = 'full'` +
      `          OR id IN (SELECT person_id FROM control WHERE user_id = ?))))`,
    binds: [like, like, viewerUserId],
  };
}
