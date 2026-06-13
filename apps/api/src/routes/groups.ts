// Group detail (Household / Classroom). Visible to members of the group (or a
// system admin). Member first names are visible to co-members (FR-15); the
// last-name rule still applies. Group-owned contact items (household cascade)
// are privacy-filtered like person items.

import { Hono } from "hono";
import type { Context } from "hono";
import type { ContactItemDTO, ContactItemInput, ContactType, GroupDetailDTO, GroupMemberDTO, ShareTargetDTO, Visibility } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { canSeeItem, displayName, sharesFor, viewerGroupIds, type ContactItemRow } from "../lib/privacy.js";
import { capabilitiesFor } from "../lib/serialize.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";
import { geocodeContact } from "../lib/geocode.js";

export const groups = new Hono<HonoEnv>();

const TYPES: ContactType[] = ["address", "phone", "email", "url"];
const VIS: Visibility[] = ["service", "private"];

/** True if any Person the user controls is an admin member of the group. */
async function isGroupAdmin(c: Context<HonoEnv>, userId: string, groupId: string): Promise<boolean> {
  const row = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM membership m JOIN control ctl ON ctl.person_id = m.person_id
     WHERE m.group_id = ? AND m.is_admin = 1 AND ctl.user_id = ? LIMIT 1`,
  )
    .bind(groupId, userId)
    .first<{ ok: number }>();
  return !!row;
}

/** Guard helper: 403 unless the caller administers the group (or is a sys admin). */
async function requireGroupAdmin(c: Context<HonoEnv>, groupId: string): Promise<string | Response> {
  const auth = requireAuth(c);
  const exists = await c.env.DB.prepare("SELECT 1 AS ok FROM grp WHERE id = ?").bind(groupId).first<{ ok: number }>();
  if (!exists) return c.json({ error: "not_found" }, 404);
  if (!auth.isSystemAdmin && !(await isGroupAdmin(c, auth.userId, groupId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  return auth.userId;
}

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

// ── Group creation ──────────────────────────────────────────────────────────

/**
 * POST /groups { kind, name } — create a Household (any member) or Classroom
 * (Teacher capability required). The creator's active Person becomes the admin.
 */
groups.post("/", async (c) => {
  const auth = requireAuth(c);
  if (!auth.activePersonId) return c.json({ error: "no_active_person" }, 400);
  const body = await c.req.json<{ kind: string; name: string }>().catch(() => null);
  const kind = body?.kind;
  const name = body?.name?.trim();
  if (!name || (kind !== "household" && kind !== "classroom")) {
    return c.json({ error: "invalid_body" }, 400);
  }

  if (kind === "classroom") {
    const teacher = await c.env.DB.prepare(
      "SELECT 1 AS ok FROM capability_grant WHERE person_id = ? AND capability = 'teacher' LIMIT 1",
    )
      .bind(auth.activePersonId)
      .first<{ ok: number }>();
    if (!teacher && !auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  }

  const id = ulid();
  const title = kind === "classroom" ? "Teacher" : "Parent";
  const stmts = [
    c.env.DB.prepare("INSERT INTO grp (id, kind, name, created_at) VALUES (?,?,?,?)").bind(id, kind, name, nowIso()),
    c.env.DB.prepare(
      "INSERT INTO membership (group_id, person_id, title, is_admin, joined_at) VALUES (?,?,?,1,?)",
    ).bind(id, auth.activePersonId, title, nowIso()),
  ];
  if (kind === "household") {
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO capability_grant (person_id, capability) VALUES (?, 'household_admin') ON CONFLICT DO NOTHING",
      ).bind(auth.activePersonId),
    );
  }
  await c.env.DB.batch(stmts);

  c.var.audit.push({ action: "admin.action", entityKind: "group", entityId: id, detail: { op: "group.create", kind } });
  return c.json({ id }, 201);
});

// ── Member management (group admins) ────────────────────────────────────────

/** GET /groups/:id/candidates?q= — Persons not already in the group (admin). */
groups.get("/:id/candidates", async (c) => {
  const groupId = c.req.param("id");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;

  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const like = `%${q}%`;
  const rows = await c.env.DB.prepare(
    `SELECT id, first_name, last_name FROM person
     WHERE id NOT IN (SELECT person_id FROM membership WHERE group_id = ?)
       AND (? = '' OR lower(first_name) LIKE ? OR lower(coalesce(last_name,'')) LIKE ?)
     ORDER BY first_name LIMIT 25`,
  )
    .bind(groupId, q, like, like)
    .all<{ id: string; first_name: string; last_name: string | null }>();
  const targets: ShareTargetDTO[] = rows.results.map((p) => ({
    kind: "person",
    id: p.id,
    name: p.last_name ? `${p.first_name} ${p.last_name.charAt(0)}.` : p.first_name,
  }));
  return c.json({ targets });
});

/** POST /groups/:id/members { personId, title?, isAdmin? } (admin). */
groups.post("/:id/members", async (c) => {
  const groupId = c.req.param("id");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;
  const body = await c.req.json<{ personId: string; title?: string; isAdmin?: boolean }>().catch(() => null);
  if (!body?.personId) return c.json({ error: "invalid_body" }, 400);

  await c.env.DB.prepare(
    `INSERT INTO membership (group_id, person_id, title, is_admin, joined_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT (group_id, person_id) DO UPDATE SET title = excluded.title`,
  )
    .bind(groupId, body.personId, body.title ?? null, body.isAdmin ? 1 : 0, nowIso())
    .run();
  c.var.audit.push({ action: "admin.action", entityKind: "group", entityId: groupId, detail: { op: "member.add", personId: body.personId } });
  return c.json({ ok: true }, 201);
});

/** PATCH /groups/:id/members/:personId { title?, isAdmin? } (admin). */
groups.patch("/:id/members/:personId", async (c) => {
  const groupId = c.req.param("id");
  const personId = c.req.param("personId");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;
  const body = await c.req.json<{ title?: string | null; isAdmin?: boolean }>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.title !== undefined) {
    sets.push("title = ?");
    binds.push(body.title ? body.title.trim() : null);
  }
  if (body.isAdmin !== undefined) {
    sets.push("is_admin = ?");
    binds.push(body.isAdmin ? 1 : 0);
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);
  binds.push(groupId, personId);
  const res = await c.env.DB.prepare(`UPDATE membership SET ${sets.join(", ")} WHERE group_id = ? AND person_id = ?`)
    .bind(...binds)
    .run();
  if (!res.meta.changes) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({ action: "admin.action", entityKind: "group", entityId: groupId, detail: { op: "member.update", personId } });
  return c.json({ ok: true });
});

/** DELETE /groups/:id/members/:personId (admin). Won't drop the last admin. */
groups.delete("/:id/members/:personId", async (c) => {
  const groupId = c.req.param("id");
  const personId = c.req.param("personId");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;

  const target = await c.env.DB.prepare(
    "SELECT is_admin FROM membership WHERE group_id = ? AND person_id = ?",
  )
    .bind(groupId, personId)
    .first<{ is_admin: number }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  if (target.is_admin === 1) {
    const adminCount = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM membership WHERE group_id = ? AND is_admin = 1",
    )
      .bind(groupId)
      .first<{ n: number }>();
    if ((adminCount?.n ?? 0) <= 1) {
      return c.json({ error: "last_admin", message: "Make someone else an admin first." }, 409);
    }
  }
  await c.env.DB.prepare("DELETE FROM membership WHERE group_id = ? AND person_id = ?").bind(groupId, personId).run();
  c.var.audit.push({ action: "admin.action", entityKind: "group", entityId: groupId, detail: { op: "member.remove", personId } });
  return c.json({ ok: true });
});

// ── Group-owned contact items (household cascade) — admin only ───────────────

/** POST /groups/:id/contacts (admin). */
groups.post("/:id/contacts", async (c) => {
  const groupId = c.req.param("id");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;
  const body = await c.req.json<ContactItemInput>().catch(() => null);
  if (!body || !TYPES.includes(body.type) || !body.value?.trim()) return c.json({ error: "invalid_body" }, 400);

  const id = ulid();
  const visibility: Visibility = VIS.includes(body.visibility as Visibility) ? (body.visibility as Visibility) : "private";
  const isAddress = body.type === "address";
  await c.env.DB.prepare(
    `INSERT INTO contact_item (id, owner_kind, owner_id, type, label, value, visibility,
       neighbor_discoverable, geocode_status, created_at, updated_at)
     VALUES (?, 'group', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, groupId, body.type, body.label ?? null, body.value.trim(), visibility,
      isAddress && body.neighborDiscoverable ? 1 : 0, isAddress ? "pending" : "none", nowIso(), nowIso())
    .run();
  c.var.audit.push({ action: "contact.created", entityKind: "contact_item", entityId: id, detail: { groupId } });
  if (isAddress) c.executionCtx.waitUntil(geocodeContact(c.env, id, body.value.trim()));
  return c.json({ id }, 201);
});

/** PATCH /groups/:id/contacts/:contactId (admin). */
groups.patch("/:id/contacts/:contactId", async (c) => {
  const groupId = c.req.param("id");
  const contactId = c.req.param("contactId");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;

  const item = await c.env.DB.prepare(
    "SELECT owner_kind, owner_id, type, value FROM contact_item WHERE id = ?",
  )
    .bind(contactId)
    .first<{ owner_kind: string; owner_id: string; type: string; value: string }>();
  if (!item || item.owner_kind !== "group" || item.owner_id !== groupId) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json<Partial<ContactItemInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const sets: string[] = [];
  const binds: unknown[] = [];
  let valueChanged = false;
  if (typeof body.value === "string" && body.value.trim()) {
    sets.push("value = ?");
    binds.push(body.value.trim());
    valueChanged = body.value.trim() !== item.value;
  }
  if (body.label !== undefined) { sets.push("label = ?"); binds.push(body.label ?? null); }
  if (body.visibility && VIS.includes(body.visibility)) { sets.push("visibility = ?"); binds.push(body.visibility); }
  if (body.neighborDiscoverable !== undefined && item.type === "address") {
    sets.push("neighbor_discoverable = ?"); binds.push(body.neighborDiscoverable ? 1 : 0);
  }
  if (valueChanged && item.type === "address") { sets.push("geocode_status = ?", "geo_lat = NULL", "geo_lng = NULL"); binds.push("pending"); }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);
  sets.push("updated_at = ?");
  binds.push(nowIso(), contactId);
  await c.env.DB.prepare(`UPDATE contact_item SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  c.var.audit.push({ action: "contact.updated", entityKind: "contact_item", entityId: contactId, detail: { groupId } });
  if (valueChanged && item.type === "address" && typeof body.value === "string") {
    c.executionCtx.waitUntil(geocodeContact(c.env, contactId, body.value.trim()));
  }
  return c.json({ ok: true });
});

/** DELETE /groups/:id/contacts/:contactId (admin). */
groups.delete("/:id/contacts/:contactId", async (c) => {
  const groupId = c.req.param("id");
  const contactId = c.req.param("contactId");
  const admin = await requireGroupAdmin(c, groupId);
  if (typeof admin !== "string") return admin;
  const item = await c.env.DB.prepare("SELECT owner_kind, owner_id FROM contact_item WHERE id = ?")
    .bind(contactId)
    .first<{ owner_kind: string; owner_id: string }>();
  if (!item || item.owner_kind !== "group" || item.owner_id !== groupId) return c.json({ error: "not_found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM contact_item WHERE id = ?").bind(contactId),
    c.env.DB.prepare("DELETE FROM share WHERE subject_kind = 'contact_item' AND subject_ref = ?").bind(contactId),
  ]);
  c.var.audit.push({ action: "contact.deleted", entityKind: "contact_item", entityId: contactId, detail: { groupId } });
  return c.json({ ok: true });
});
