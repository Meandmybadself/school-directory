// Persons & profiles — privacy-filtered reads, controller-gated writes.

import { Hono } from "hono";
import type { PersonPatchBody } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { buildProfile } from "../lib/serialize.js";
import { isController } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";

export const persons = new Hono<HonoEnv>();

const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

/** GET /persons/:id — profile as the active viewer is permitted to see it. */
persons.get("/:id", async (c) => {
  const auth = requireAuth(c);
  const viewer = { userId: auth.userId, personId: auth.activePersonId };
  const profile = await buildProfile(c.env, viewer, c.req.param("id"));
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
