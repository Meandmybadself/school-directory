// Build privacy-filtered DTOs for the wire. All visibility decisions resolve
// here via privacy.ts; geo coordinates are dropped by construction.

import type {
  Capability,
  ContactItemDTO,
  GroupSummaryDTO,
  LastNameDisplay,
  PersonProfileDTO,
} from "@sd/shared";
import type { Env } from "../env.js";
import {
  canSeeItem,
  controllerUserIds,
  displayName,
  sharesFor,
  viewerGroupIds,
  type ContactItemRow,
  type Viewer,
} from "./privacy.js";

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  last_name_visibility: LastNameDisplay;
  photo_object_key: string | null;
}

export async function capabilitiesFor(env: Env, personId: string): Promise<Capability[]> {
  const rows = await env.DB.prepare(
    "SELECT capability FROM capability_grant WHERE person_id = ?",
  )
    .bind(personId)
    .all<{ capability: Capability }>();
  return rows.results.map((r) => r.capability);
}

async function groupsFor(
  env: Env,
  personId: string,
  viewerPersonId: string | null,
): Promise<GroupSummaryDTO[]> {
  const rows = await env.DB.prepare(
    `SELECT g.id, g.kind, g.name, g.parent_id,
            (SELECT COUNT(*) FROM membership m2 WHERE m2.group_id = g.id) AS member_count,
            m.is_admin AS person_is_admin
     FROM membership m JOIN grp g ON g.id = m.group_id
     WHERE m.person_id = ?`,
  )
    .bind(personId)
    .all<{
      id: string;
      kind: GroupSummaryDTO["kind"];
      name: string;
      parent_id: string | null;
      member_count: number;
      person_is_admin: number;
    }>();

  // Whether the *viewer* is an admin of each group (controls edit affordances).
  const viewerAdmin = new Set<string>();
  if (viewerPersonId) {
    const va = await env.DB.prepare(
      "SELECT group_id FROM membership WHERE person_id = ? AND is_admin = 1",
    )
      .bind(viewerPersonId)
      .all<{ group_id: string }>();
    for (const r of va.results) viewerAdmin.add(r.group_id);
  }

  return rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    memberCount: r.member_count,
    isAdmin: viewerAdmin.has(r.id),
    parentId: r.parent_id,
  }));
}

function photoUrl(key: string | null): string | null {
  return key ? `/photos/${key}` : null;
}

/** Build a profile DTO for `viewer` looking at `personId`, or null if missing. */
export async function buildProfile(
  env: Env,
  viewer: Viewer,
  personId: string,
): Promise<PersonProfileDTO | null> {
  const person = await env.DB.prepare(
    "SELECT id, first_name, last_name, last_name_visibility, photo_object_key FROM person WHERE id = ?",
  )
    .bind(personId)
    .first<PersonRow>();
  if (!person) return null;

  const controllers = await controllerUserIds(env, personId);
  const viewerIsController = controllers.has(viewer.userId);
  const vGroups = await viewerGroupIds(env, viewer);

  // Contact items owned by this person.
  const itemRows = await env.DB.prepare(
    `SELECT id, owner_kind, owner_id, type, label, value, visibility,
            neighbor_discoverable, geo_lat, geo_lng
     FROM contact_item WHERE owner_kind = 'person' AND owner_id = ? ORDER BY sort_order, created_at`,
  )
    .bind(personId)
    .all<ContactItemRow>();

  const contacts: ContactItemDTO[] = [];
  for (const item of itemRows.results) {
    const shares = await sharesFor(env, "contact_item", item.id);
    const visible = canSeeItem({
      viewer,
      item,
      ownerControllerUserIds: controllers,
      sharedWithPersonIds: shares.persons,
      sharedWithGroupIds: shares.groups,
      viewerGroups: vGroups,
    });
    if (!visible) continue;

    const dto: ContactItemDTO = {
      id: item.id,
      type: item.type as ContactItemDTO["type"],
      label: item.label,
      // Addresses never reveal the raw value to non-controllers.
      value:
        item.type === "address" && !viewerIsController
          ? "" // client shows "Exact address hidden"; coords already absent
          : item.value,
      visibility: item.visibility,
    };
    if (item.type === "address") {
      dto.neighborDiscoverable = item.neighbor_discoverable === 1;
      // Coordinates stay server-side; we only signal that a map can be rendered.
      dto.hasLocation = viewerIsController && item.geo_lat != null && item.geo_lng != null;
    }
    if (item.visibility === "private" && shares.count > 0) dto.shareCount = shares.count;
    contacts.push(dto);
  }

  const display = person.last_name_visibility;
  const profile: PersonProfileDTO = {
    id: person.id,
    firstName: person.first_name,
    displayName: displayName(person.first_name, person.last_name, display, viewerIsController),
    capabilities: await capabilitiesFor(env, personId),
    photoUrl: photoUrl(person.photo_object_key),
    contacts,
    groups: await groupsFor(env, personId, viewer.personId),
    controlledByViewer: viewerIsController,
  };

  // Owner-only editable fields.
  if (viewerIsController) {
    profile.lastName = person.last_name;
    profile.lastNameDisplay = display;
  }

  return profile;
}
