// Persons & profiles — privacy-filtered reads, controller-gated writes.

import { Hono } from "hono";
import type { PersonPatchBody } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { buildProfile } from "../lib/serialize.js";
import { isController } from "../lib/privacy.js";
import { nowIso } from "../lib/time.js";
import { ulid } from "../lib/ids.js";

export const persons = new Hono<HonoEnv>();

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/** GET /persons/:id — profile as the active viewer is permitted to see it.
 *  `?as=member` asks a Controller's view to be downgraded to a plain member's,
 *  so the view screen is an honest preview of what everyone else sees. */
persons.get("/:id", async (c) => {
  const auth = requireAuth(c);
  const viewer = { userId: auth.userId, personId: auth.activePersonId };
  const profile = await buildProfile(c.env, viewer, c.req.param("id"), {
    asMember: c.req.query("as") === "member",
    isSystemAdmin: auth.isSystemAdmin,
  });
  if (!profile) return c.json({ error: "not_found" }, 404);
  return c.json(profile);
});

/** PATCH /persons/:id — update name fields. Controllers only. */
persons.patch("/:id", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const body = await c.req.json<PersonPatchBody>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.firstName === "string" && body.firstName.trim()) {
    sets.push("first_name = ?");
    binds.push(body.firstName.trim());
  }
  if (body.lastName !== undefined) {
    sets.push("last_name = ?");
    binds.push(body.lastName ? body.lastName.trim() : null);
  }
  if (body.lastNameDisplay && ["full", "initial"].includes(body.lastNameDisplay)) {
    sets.push("last_name_visibility = ?");
    binds.push(body.lastNameDisplay);
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);

  binds.push(personId);
  await c.env.DB.prepare(`UPDATE person SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  c.var.audit.push({
    action: "person.updated",
    entityKind: "person",
    entityId: personId,
    detail: { fields: sets.map((s) => s.split(" ")[0]) },
  });

  const profile = await buildProfile(
    c.env,
    { userId: auth.userId, personId: auth.activePersonId },
    personId,
    { isSystemAdmin: auth.isSystemAdmin },
  );
  return c.json(profile);
});

/** POST /persons/:id/photo — upload a profile photo to R2. Controllers only.
 *  Body is the raw image; Content-Type identifies the format. */
persons.post("/:id/photo", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim();
  const ext = PHOTO_TYPES[contentType];
  if (!ext) return c.json({ error: "unsupported_type" }, 415);

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) return c.json({ error: "empty" }, 400);
  if (body.byteLength > MAX_PHOTO_BYTES) return c.json({ error: "too_large" }, 413);

  const key = `${ulid()}.${ext}`;
  await c.env.PHOTOS.put(key, body, { httpMetadata: { contentType } });

  // UNLISTED-EXEMPT: single row by id behind an isController gate, and it
  // returns no identity — just the key of the object being replaced.
  const prev = await c.env.DB.prepare("SELECT photo_object_key FROM person WHERE id = ?")
    .bind(personId)
    .first<{ photo_object_key: string | null }>();
  await c.env.DB.prepare("UPDATE person SET photo_object_key = ? WHERE id = ?")
    .bind(key, personId)
    .run();
  if (prev?.photo_object_key) {
    c.executionCtx.waitUntil(c.env.PHOTOS.delete(prev.photo_object_key));
  }

  c.var.audit.push({ action: "person.updated", entityKind: "person", entityId: personId, detail: { photo: true } });
  return c.json({ photoUrl: `/photos/${key}` }, 201);
});

/** POST /persons/:id/unlisted { unlisted } — take a Person off the roster, or
 *  put them back.
 *
 *  System-admin only, and deliberately not something a Controller may do to
 *  their own Person. Every other privacy control here governs what one FIELD
 *  reveals — `visibility`, `neighborDiscoverable`, `lastNameDisplay`. This one
 *  removes someone from the census: from classroom rosters, from a co-parent's
 *  search, from the volunteer names a sheet shows. That is a different kind of
 *  withholding, and it is the school's call rather than a family's.
 *
 *  Idempotent, like POST /admin/users/:id/disabled: setting what is already set
 *  is an answer, not a failure. A Controller still SEES the flag on a Person
 *  they control (buildProfile surfaces it to them) — they just can't move it.
 */
persons.post("/:id/unlisted", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const personId = c.req.param("id");
  const body = await c.req.json<{ unlisted?: boolean }>().catch(() => null);
  if (typeof body?.unlisted !== "boolean") return c.json({ error: "invalid_body" }, 400);

  // UNLISTED-EXEMPT: the route is system-admin gated above, and this is the one
  // read whose whole job is to find a Person the gate would hide.
  const target = await c.env.DB.prepare("SELECT id, unlisted_at FROM person WHERE id = ?")
    .bind(personId)
    .first<{ id: string; unlisted_at: string | null }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const already = target.unlisted_at !== null;
  if (already === body.unlisted) return c.json({ ok: true, unlisted: already });

  const unlistedAt = body.unlisted ? nowIso() : null;
  await c.env.DB.prepare("UPDATE person SET unlisted_at = ? WHERE id = ?")
    .bind(unlistedAt, personId)
    .run();

  c.var.audit.push({
    action: "admin.action",
    entityKind: "person",
    entityId: personId,
    detail: { op: body.unlisted ? "person.unlisted" : "person.relisted" },
  });
  return c.json({ ok: true, unlisted: body.unlisted });
});
