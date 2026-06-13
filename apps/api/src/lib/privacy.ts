// Privacy resolution — the single most important server function (SDD §5).
// Given a viewer (the active Person of the requesting User) and a target item,
// decide visibility. Filtering happens here, server-side, before serialization.
// geo_lat/geo_lng are NEVER serialized regardless of permission.

import type { LastNameDisplay, Visibility } from "@sd/shared";
import type { Env } from "../env.js";

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

/** Group ids the viewer's active Person belongs to. */
export async function viewerGroupIds(env: Env, viewer: Viewer): Promise<Set<string>> {
  if (!viewer.personId) return new Set();
  const rows = await env.DB.prepare(
    "SELECT group_id FROM membership WHERE person_id = ?",
  )
    .bind(viewer.personId)
    .all<{ group_id: string }>();
  return new Set(rows.results.map((r) => r.group_id));
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

/** Shares grouped by target kind for one subject (contact item or field ref). */
export async function sharesFor(
  env: Env,
  subjectKind: "contact_item" | "field",
  subjectRef: string,
): Promise<{ persons: Set<string>; groups: Set<string>; count: number }> {
  const rows = await env.DB.prepare(
    "SELECT target_kind, target_id FROM share WHERE subject_kind = ? AND subject_ref = ?",
  )
    .bind(subjectKind, subjectRef)
    .all<{ target_kind: string; target_id: string }>();
  const persons = new Set<string>();
  const groups = new Set<string>();
  for (const r of rows.results) {
    if (r.target_kind === "person") persons.add(r.target_id);
    else if (r.target_kind === "group") groups.add(r.target_id);
  }
  return { persons, groups, count: rows.results.length };
}
