// Persons & profiles — privacy-filtered reads, controller-gated writes.

import { Hono } from "hono";
import type { PersonPatchBody } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { buildProfile } from "../lib/serialize.js";
import { isController } from "../lib/privacy.js";

export const persons = new Hono<HonoEnv>();

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
  if (body.lastNameDisplay && ["full", "initial", "hidden"].includes(body.lastNameDisplay)) {
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
