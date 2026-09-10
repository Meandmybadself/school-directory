// Build privacy-filtered DTOs for the wire. All visibility decisions resolve
// here via privacy.ts; geo coordinates are dropped by construction.

import type {
  Capability,
  ContactItemDTO,
  GroupSummaryDTO,
  HouseholdMembersDTO,
  LastNameDisplay,
  PersonProfileDTO,
} from "@sd/shared";
import type { Env } from "../env.js";
import {
  canSeeItem,
  controllerUserIds,
  displayName,
  personListableSql,
  sharesForMany,
  sharesOf,
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
  unlisted_at: string | null;
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

/**
 * The other Persons in each of `personId`'s households, as `viewer` may see them.
 *
 * This exists because the schema records no kinship: `control` is User→Person
 * (a credential relationship — invariant 24 is explicit that a grandparent or
 * the school nurse can hold it), `capability_grant` says what someone IS rather
 * than whose, and there is no Person→Person edge at all. Co-residence in a
 * `household` group is the whole of what "family" means here, so this is the
 * only rendering of one there can be.
 *
 * The enumeration gate is COMPOSED, not assumed from the household join. This
 * is a listing — the viewer named the profile's subject, never these Persons —
 * so an unlisted co-member must not appear on it, exactly as `GET /groups/:id`'s
 * roster drops them. Note the deliberate asymmetry with `groupsFor`'s
 * `member_count`, which stays an unfiltered `COUNT(*)` per invariant 21
 * ("numbers, never identities"): this array can be shorter, which is why the
 * profile stops rendering that count for any household it can show faces for.
 * Putting the two side by side is what would turn the pair into an oracle.
 *
 * `asMember` degrades RENDERING only (the surname rule), never findability —
 * the same split `buildProfile` draws between `opts.asMember` and
 * `opts.isSystemAdmin`.
 */
export async function householdsFor(
  env: Env,
  viewer: Viewer,
  personId: string,
  opts: { isSystemAdmin: boolean; asMember: boolean },
): Promise<HouseholdMembersDTO[]> {
  const listable = personListableSql(viewer.userId, opts.isSystemAdmin, "p");
  const rows = await env.DB.prepare(
    `SELECT m.group_id, g.name AS group_name,
            p.id, p.first_name, p.last_name, p.last_name_visibility, p.photo_object_key
     FROM membership m
     JOIN grp g ON g.id = m.group_id
     JOIN person p ON p.id = m.person_id
     WHERE g.kind = 'household'
       AND m.group_id IN (SELECT group_id FROM membership WHERE person_id = ?)
       AND m.person_id != ?
       AND ${listable.sql}
     ORDER BY g.name, p.first_name`,
  )
    .bind(personId, personId, ...listable.binds)
    .all<{
      group_id: string;
      group_name: string;
      id: string;
      first_name: string;
      last_name: string | null;
      last_name_visibility: LastNameDisplay;
      photo_object_key: string | null;
    }>();
  if (rows.results.length === 0) return [];

  const ids = [...new Set(rows.results.map((r) => r.id))];
  const ph = ids.map(() => "?").join(",");

  // One capability read for the whole roster rather than `capabilitiesFor` per
  // member: the tags are the point of the block (they are as close to "parent"
  // and "child" as this schema gets), so they can't be dropped to save a query.
  const capRows = await env.DB.prepare(
    `SELECT person_id, capability FROM capability_grant WHERE person_id IN (${ph})`,
  )
    .bind(...ids)
    .all<{ person_id: string; capability: Capability }>();
  const caps = new Map<string, Capability[]>();
  for (const r of capRows.results) {
    const list = caps.get(r.person_id);
    if (list) list.push(r.capability);
    else caps.set(r.person_id, [r.capability]);
  }

  // Which of these the viewer controls, per member — the surname rule is theirs
  // to be exempt from one Person at a time, not wholesale. Viewing a partner's
  // profile must still spell out your own child's name in full.
  const controlled = new Set<string>();
  if (!opts.asMember) {
    const mine = await env.DB.prepare(
      `SELECT person_id FROM control WHERE user_id = ? AND person_id IN (${ph})`,
    )
      .bind(viewer.userId, ...ids)
      .all<{ person_id: string }>();
    for (const r of mine.results) controlled.add(r.person_id);
  }

  const byHousehold = new Map<string, HouseholdMembersDTO>();
  for (const r of rows.results) {
    let hh = byHousehold.get(r.group_id);
    if (!hh) {
      hh = { id: r.group_id, name: r.group_name, members: [] };
      byHousehold.set(r.group_id, hh);
    }
    // Built field by field. A spread of the row would put `photo_object_key` and
    // `last_name` on the wire beside the display name that exists to withhold it.
    hh.members.push({
      id: r.id,
      displayName: displayName(
        r.first_name,
        r.last_name,
        r.last_name_visibility,
        controlled.has(r.id),
      ),
      firstName: r.first_name,
      capabilities: caps.get(r.id) ?? [],
      photoUrl: photoUrl(r.photo_object_key),
    });
  }
  return [...byHousehold.values()];
}

export interface BuildProfileOptions {
  /** Render the profile as an ordinary member sees it, dropping the Controller
   *  shortcut. Only meaningful (and only honoured) when the viewer actually
   *  controls the Person — for everyone else the normal rules already apply and
   *  suppressing their shares would UNDER-report what they may see. */
  asMember?: boolean;
  /** Whether the viewer is a system admin. Governs which Persons the read can
   *  FIND at all (`personListableSql`), which is a different axis from
   *  `asMember` — that only degrades what is rendered from a row already found.
   *  An admin previewing a member's-eye view of someone they don't control must
   *  still reach the row, so the two never gate each other. */
  isSystemAdmin?: boolean;
}

/** Build a profile DTO for `viewer` looking at `personId`, or null if missing. */
export async function buildProfile(
  env: Env,
  viewer: Viewer,
  personId: string,
  opts: BuildProfileOptions = {},
): Promise<PersonProfileDTO | null> {
  // The enumeration gate is baked into the WHERE rather than checked after, so
  // an unlisted Person is simply not found — a member who guesses the ULID gets
  // the same 404 as for one that never existed. A listing that hides someone
  // while still serving their profile is the oracle invariant 18 describes.
  const listable = personListableSql(viewer.userId, opts.isSystemAdmin === true);
  const person = await env.DB.prepare(
    `SELECT id, first_name, last_name, last_name_visibility, photo_object_key, unlisted_at
     FROM person WHERE id = ? AND ${listable.sql}`,
  )
    .bind(personId, ...listable.binds)
    .first<PersonRow>();
  if (!person) return null;

  const controllers = await controllerUserIds(env, personId);
  const controlsPerson = controllers.has(viewer.userId);
  // Preview mode: a Controller asks to see the profile through a plain member's
  // eyes. `controlsPerson` still drives edit affordances; `viewerIsController`
  // drives every privacy decision below and is forced off while previewing.
  const previewAsMember = opts.asMember === true && controlsPerson;
  const viewerIsController = controlsPerson && !previewAsMember;
  const vGroups = await viewerGroupIds(env, viewer);
  // A generic member is nobody's share target, so previews resolve against
  // empty share/group sets rather than the previewer's own memberships.
  const noShares = new Set<string>();
  let hiddenFromMembers = 0;

  // Contact items owned by this person.
  const itemRows = await env.DB.prepare(
    `SELECT id, owner_kind, owner_id, type, label, value, visibility,
            neighbor_discoverable, geo_lat, geo_lng
     FROM contact_item WHERE owner_kind = 'person' AND owner_id = ? ORDER BY sort_order, created_at`,
  )
    .bind(personId)
    .all<ContactItemRow>();

  // One query for every item's shares rather than one per item — the loop below
  // used to be the dominant cost of building a profile.
  const shareMap = await sharesForMany(env, "contact_item", itemRows.results.map((i) => i.id));

  const contacts: ContactItemDTO[] = [];
  for (const item of itemRows.results) {
    const shares = sharesOf(shareMap, item.id);
    const visible = canSeeItem({
      viewer,
      item,
      ownerControllerUserIds: previewAsMember ? noShares : controllers,
      sharedWithPersonIds: previewAsMember ? noShares : shares.persons,
      sharedWithGroupIds: previewAsMember ? noShares : shares.groups,
      viewerGroups: previewAsMember ? noShares : vGroups,
    });
    if (!visible) {
      hiddenFromMembers++;
      continue;
    }

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

  // Cascaded group contacts: items owned by groups this Person is a DIRECT
  // member of (e.g. a household's shared address) surface on the profile, but
  // stay read-only here (edited on the group). Visibility uses the GROUP-contact
  // rule from the viewer's perspective: service → any member; otherwise only a
  // fellow direct member of that group, or an explicit share. The exact address
  // value is shown only to fellow direct members.
  const viewerDirectGroups = new Set<string>();
  if (viewer.personId && !previewAsMember) {
    const vd = await env.DB.prepare("SELECT group_id FROM membership WHERE person_id = ?")
      .bind(viewer.personId)
      .all<{ group_id: string }>();
    for (const r of vd.results) viewerDirectGroups.add(r.group_id);
  }
  const gcRows = await env.DB.prepare(
    `SELECT ci.id, ci.owner_kind, ci.owner_id, ci.type, ci.label, ci.value, ci.visibility,
            ci.neighbor_discoverable, ci.geo_lat, ci.geo_lng, g.name AS group_name
     FROM contact_item ci
     JOIN membership m ON m.group_id = ci.owner_id
     JOIN grp g ON g.id = ci.owner_id
     WHERE ci.owner_kind = 'group' AND m.person_id = ?
     ORDER BY ci.sort_order, ci.created_at`,
  )
    .bind(personId)
    .all<ContactItemRow & { group_name: string }>();

  const gcShareMap = await sharesForMany(env, "contact_item", gcRows.results.map((i) => i.id));

  const groupContacts: ContactItemDTO[] = [];
  for (const item of gcRows.results) {
    const shares = sharesOf(gcShareMap, item.id);
    const viewerInGroup = viewerDirectGroups.has(item.owner_id);
    const visible =
      item.visibility === "service" ||
      viewerInGroup ||
      canSeeItem({
        viewer,
        item,
        ownerControllerUserIds: new Set(),
        sharedWithPersonIds: previewAsMember ? noShares : shares.persons,
        sharedWithGroupIds: previewAsMember ? noShares : shares.groups,
        viewerGroups: previewAsMember ? noShares : vGroups,
      });
    // Not counted in hiddenFromMembers: these belong to the group, not the
    // Person, so they aren't something Edit on this profile can change.
    if (!visible) continue;
    const dto: ContactItemDTO = {
      id: item.id,
      type: item.type as ContactItemDTO["type"],
      label: item.label,
      value: item.type === "address" && !viewerInGroup ? "" : item.value,
      visibility: item.visibility,
      viaGroup: { id: item.owner_id, name: item.group_name },
    };
    if (item.type === "address") dto.neighborDiscoverable = item.neighbor_discoverable === 1;
    groupContacts.push(dto);
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
    controlledByViewer: controlsPerson,
  };
  if (groupContacts.length) profile.groupContacts = groupContacts;
  // Inline rather than a route of its own, unlike `GET /persons/:id/removal-impact`
  // — that one is its own route so an ordinary profile view doesn't pay for six
  // counts nobody reads, and it is opened rarely. This block is on screen every
  // time, so the two queries belong where the rest of the profile is built.
  const households = await householdsFor(env, viewer, personId, {
    isSystemAdmin: opts.isSystemAdmin === true,
    asMember: previewAsMember,
  });
  if (households.length) profile.households = households;
  // Safe to state plainly: anyone who reached this line already cleared the gate
  // above, so they are an admin or a Controller — the two audiences entitled to
  // know. A member never sees the field because they never see the profile.
  if (person.unlisted_at) profile.unlisted = true;
  if (previewAsMember) {
    profile.previewAsMember = true;
    profile.hiddenFromMembers = hiddenFromMembers;
  }

  // Owner-only editable fields.
  if (viewerIsController) {
    profile.lastName = person.last_name;
    profile.lastNameDisplay = display;
  }

  return profile;
}
