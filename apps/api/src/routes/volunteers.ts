// Volunteer signups — the MEMBER half. Reading a sheet here returns who took
// each spot, which is the whole difference from routes/volunteersPublic.ts; both
// are served from the same rows and narrowed by lib/volunteers.ts.
//
// Every route requires a session. That is the user-facing rule for this feature:
// anyone may read a published sheet, but claiming or releasing a spot is a write
// and writes need an account. There is deliberately no anonymous claim path — a
// name on a signup sheet has to be attributable to a directory Person.

import { Hono } from "hono";
import type { VolunteerSignupInput } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController } from "../lib/privacy.js";
import {
  claimSpot,
  loadSheetForMember,
  releaseSpot,
  signupOwner,
  viewerOf,
} from "../lib/volunteers.js";

export const volunteers = new Hono<HonoEnv>();

/** GET /volunteers/sheets/:slug — one sheet, with names. */
volunteers.get("/sheets/:slug", async (c) => {
  const auth = requireAuth(c);
  const viewer = await viewerOf(c.env, auth.userId, auth.isSystemAdmin);
  const sheet = await loadSheetForMember(c.env, c.req.param("slug"), viewer);
  if (!sheet) return c.json({ error: "not_found" }, 404);
  return c.json({ sheet });
});

/** POST /volunteers/positions/:id/signups { personId, note? } — take a spot.
 *
 *  The Person must be one the caller controls. That check is here rather than in
 *  the lib because it is an authorization decision and belongs next to the
 *  session — and because it is what stops a member from signing up a family they
 *  have never met. A system admin may sign up anyone, which is how the office
 *  records a phone call.
 *
 *  409 covers all three ways a claim can lose a race or repeat itself; the
 *  `reason` tells the client which message to show. */
volunteers.post("/positions/:id/signups", async (c) => {
  const auth = requireAuth(c);
  const body = await c.req.json<VolunteerSignupInput>().catch(() => null);
  const personId = body?.personId?.trim();
  if (!personId) return c.json({ error: "invalid_body" }, 400);

  if (!auth.isSystemAdmin && !(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  const result = await claimSpot(
    c.env,
    c.req.param("id"),
    personId,
    auth.userId,
    body?.note ?? null,
  );
  if (!result.ok) {
    if (result.reason === "not_found") return c.json({ error: "not_found" }, 404);
    return c.json({ error: result.reason }, 409);
  }

  c.var.audit.push({
    action: "volunteer.signup.created",
    entityKind: "volunteer_position",
    entityId: c.req.param("id"),
    detail: { personId },
  });

  const viewer = await viewerOf(c.env, auth.userId, auth.isSystemAdmin);
  const sheet = await loadSheetForMember(c.env, result.slug!, viewer);
  return c.json({ sheet }, 201);
});

/** DELETE /volunteers/signups/:id — give a spot back.
 *
 *  Allowed for a controller of the Person who holds it, and for system admins
 *  (who need to clear a spot when someone tells them in person). Note that the
 *  test is control of the PERSON, not "did you create this row": two parents may
 *  both control a child, and either should be able to undo the other's signup. */
volunteers.delete("/signups/:id", async (c) => {
  const auth = requireAuth(c);
  const owner = await signupOwner(c.env, c.req.param("id"));
  if (!owner) return c.json({ error: "not_found" }, 404);

  if (!auth.isSystemAdmin && !(await isController(c.env, auth.userId, owner.personId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  await releaseSpot(c.env, c.req.param("id"));
  c.var.audit.push({
    action: "volunteer.signup.deleted",
    entityKind: "volunteer_signup",
    entityId: c.req.param("id"),
    detail: { personId: owner.personId },
  });

  const viewer = await viewerOf(c.env, auth.userId, auth.isSystemAdmin);
  const sheet = await loadSheetForMember(c.env, owner.slug, viewer);
  return c.json({ sheet });
});
