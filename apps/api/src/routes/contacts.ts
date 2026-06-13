// Contact items — create/update/delete. Controller-gated. Addresses get a
// neighbor-discoverable flag; geocoding is wired in M3 (status starts 'pending').

import { Hono } from "hono";
import type { ContactItemInput, ContactType, Visibility } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { nowIso } from "../lib/time.js";

export const contacts = new Hono<HonoEnv>();

const TYPES: ContactType[] = ["address", "phone", "email", "url"];
const VIS: Visibility[] = ["service", "private"];

/** POST /persons/:id/contacts — add a contact item. */
contacts.post("/persons/:id/contacts", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = await c.req.json<ContactItemInput>().catch(() => null);
  if (!body || !TYPES.includes(body.type) || !body.value?.trim()) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const id = ulid();
  const visibility: Visibility = VIS.includes(body.visibility as Visibility)
    ? (body.visibility as Visibility)
    : "private"; // new fields default to private (NFR-1)
  const isAddress = body.type === "address";
  await c.env.DB.prepare(
    `INSERT INTO contact_item
       (id, owner_kind, owner_id, type, label, value, visibility,
        neighbor_discoverable, geocode_status, created_at, updated_at)
     VALUES (?, 'person', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      personId,
      body.type,
      body.label ?? null,
      body.value.trim(),
      visibility,
      isAddress && body.neighborDiscoverable ? 1 : 0,
      isAddress ? "pending" : "none",
      nowIso(),
      nowIso(),
    )
    .run();

  c.var.audit.push({
    action: "contact.created",
    entityKind: "contact_item",
    entityId: id,
    detail: { type: body.type, personId },
  });
  return c.json({ id }, 201);
});

/** PATCH /contacts/:id — update value/label/visibility/neighbor flag. */
contacts.patch("/contacts/:id", async (c) => {
  const auth = requireAuth(c);
  const id = c.req.param("id");

  const item = await c.env.DB.prepare(
    "SELECT owner_kind, owner_id, type, value FROM contact_item WHERE id = ?",
  )
    .bind(id)
    .first<{ owner_kind: string; owner_id: string; type: string; value: string }>();
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.owner_kind !== "person" || !(await isController(c.env, auth.userId, item.owner_id))) {
    return c.json({ error: "forbidden" }, 403);
  }

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
  if (body.label !== undefined) {
    sets.push("label = ?");
    binds.push(body.label ?? null);
  }
  if (body.visibility && VIS.includes(body.visibility)) {
    sets.push("visibility = ?");
    binds.push(body.visibility);
  }
  if (body.neighborDiscoverable !== undefined && item.type === "address") {
    sets.push("neighbor_discoverable = ?");
    binds.push(body.neighborDiscoverable ? 1 : 0);
  }
  // Re-geocode if an address value changed (M3 queue picks up 'pending').
  if (valueChanged && item.type === "address") {
    sets.push("geocode_status = ?", "geo_lat = NULL", "geo_lng = NULL");
    binds.push("pending");
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  sets.push("updated_at = ?");
  binds.push(nowIso(), id);
  await c.env.DB.prepare(`UPDATE contact_item SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  c.var.audit.push({ action: "contact.updated", entityKind: "contact_item", entityId: id });
  return c.json({ ok: true });
});

/** DELETE /contacts/:id */
contacts.delete("/contacts/:id", async (c) => {
  const auth = requireAuth(c);
  const id = c.req.param("id");
  const item = await c.env.DB.prepare(
    "SELECT owner_kind, owner_id FROM contact_item WHERE id = ?",
  )
    .bind(id)
    .first<{ owner_kind: string; owner_id: string }>();
  if (!item) return c.json({ error: "not_found" }, 404);
  if (item.owner_kind !== "person" || !(await isController(c.env, auth.userId, item.owner_id))) {
    return c.json({ error: "forbidden" }, 403);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM contact_item WHERE id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM share WHERE subject_kind = 'contact_item' AND subject_ref = ?").bind(id),
  ]);
  c.var.audit.push({ action: "contact.deleted", entityKind: "contact_item", entityId: id });
  return c.json({ ok: true });
});
