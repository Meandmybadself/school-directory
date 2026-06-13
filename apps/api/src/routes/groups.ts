// Group detail (Household / Classroom). Visible to members of the group (or a
// system admin). Member first names are visible to co-members (FR-15); the
// last-name rule still applies. Group-owned contact items (household cascade)
// are privacy-filtered like person items.

import { Hono } from "hono";
import type { ContactItemDTO, GroupDetailDTO, GroupMemberDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { canSeeItem, displayName, sharesFor, viewerGroupIds, type ContactItemRow } from "../lib/privacy.js";
import { capabilitiesFor } from "../lib/serialize.js";

export const groups = new Hono<HonoEnv>();

groups.get("/:id", async (c) => {
  const auth = requireAuth(c);
  const groupId = c.req.param("id");
  const viewer = { userId: auth.userId, personId: auth.activePersonId };

  const group = await c.env.DB.prepare("SELECT id, kind, name FROM grp WHERE id = ?")
    .bind(groupId)
    .first<{ id: string; kind: GroupDetailDTO["kind"]; name: string }>();
  if (!group) return c.json({ error: "not_found" }, 404);

  // Membership rows for this group.
  const memberRows = await c.env.DB.prepare(
    `SELECT m.person_id, m.title, m.is_admin,
            p.first_name, p.last_name, p.last_name_visibility, p.photo_object_key
     FROM membership m JOIN person p ON p.id = m.person_id
     WHERE m.group_id = ? ORDER BY m.is_admin DESC, p.first_name`,
  )
    .bind(groupId)
    .all<{
      person_id: string;
      title: string | null;
      is_admin: number;
      first_name: string;
      last_name: string | null;
      last_name_visibility: "full" | "initial" | "hidden";
      photo_object_key: string | null;
    }>();

  // The viewer's controlled Persons (to flag "You" and to gate access).
  const controlled = await c.env.DB.prepare(
    "SELECT person_id FROM control WHERE user_id = ?",
  )
    .bind(auth.userId)
    .all<{ person_id: string }>();
  const myPersonIds = new Set(controlled.results.map((r) => r.person_id));

  const viewerIsMember = memberRows.results.some((m) => myPersonIds.has(m.person_id));
  const viewerIsAdmin = memberRows.results.some((m) => myPersonIds.has(m.person_id) && m.is_admin === 1);
  if (!viewerIsMember && !auth.isSystemAdmin) {
    return c.json({ error: "forbidden" }, 403);
  }

  const members: GroupMemberDTO[] = [];
  for (const m of memberRows.results) {
    members.push({
      personId: m.person_id,
      // First name is always visible to co-members; last name rule applied.
      displayName: displayName(m.first_name, m.last_name, m.last_name_visibility, myPersonIds.has(m.person_id)),
      title: m.title,
      isAdmin: m.is_admin === 1,
      isYou: myPersonIds.has(m.person_id),
      capabilities: await capabilitiesFor(c.env, m.person_id),
      photoUrl: m.photo_object_key ? `/photos/${m.photo_object_key}` : null,
    });
  }

  // Group-owned contact items (e.g. household shared address).
  const itemRows = await c.env.DB.prepare(
    `SELECT id, owner_kind, owner_id, type, label, value, visibility,
            neighbor_discoverable, geo_lat, geo_lng
     FROM contact_item WHERE owner_kind = 'group' AND owner_id = ? ORDER BY sort_order, created_at`,
  )
    .bind(groupId)
    .all<ContactItemRow>();

  const vGroups = await viewerGroupIds(c.env, viewer);
  const contacts: ContactItemDTO[] = [];
  for (const item of itemRows.results) {
    const shares = await sharesFor(c.env, "contact_item", item.id);
    // Members of the group can see service-visibility group contacts; controllers
    // set is empty for groups, so membership is the gate for 'service'.
    const visible =
      (item.visibility === "service" && (viewerIsMember || auth.isSystemAdmin)) ||
      canSeeItem({
        viewer,
        item,
        ownerControllerUserIds: new Set(),
        sharedWithPersonIds: shares.persons,
        sharedWithGroupIds: shares.groups,
        viewerGroups: vGroups,
      });
    if (!visible) continue;
    const dto: ContactItemDTO = {
      id: item.id,
      type: item.type as ContactItemDTO["type"],
      label: item.label,
      value: item.type === "address" && !viewerIsAdmin && !viewerIsMember ? "" : item.value,
      visibility: item.visibility,
    };
    if (item.type === "address") dto.neighborDiscoverable = item.neighbor_discoverable === 1;
    if (item.visibility === "private" && shares.count > 0) dto.shareCount = shares.count;
    contacts.push(dto);
  }

  const dto: GroupDetailDTO = {
    id: group.id,
    kind: group.kind,
    name: group.name,
    memberCount: memberRows.results.length,
    viewerIsAdmin,
    viewerIsMember,
    members,
    contacts,
  };
  return c.json(dto);
});
