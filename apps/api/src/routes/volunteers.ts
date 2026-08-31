// Volunteer signups — the MEMBER half. Reading a sheet here returns who took
// each spot, which is the whole difference from routes/volunteersPublic.ts; both
// are served from the same rows and narrowed by lib/volunteers.ts.
//
// Every route requires a session. That is the user-facing rule for this feature:
// anyone may read a published sheet, but claiming or releasing a spot is a write
// and writes need an account. There is deliberately no anonymous claim path — a
// name on a signup sheet has to be attributable to a directory Person.

import { Hono } from "hono";
import type { VolunteerSheetDTO, VolunteerSignupInput } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import type { AuditDraft } from "../lib/audit.js";
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

/** The half of a signup's `notify` bag that can only be read off the reloaded
 *  sheet — what the spot was called, and how full it is now.
 *
 *  Split out from the push itself because of WHEN it can be known. The audit
 *  draft has to be pushed the moment the write commits (invariant 5); these
 *  fields need a read that comes after and may fail. So the draft goes in with
 *  what is certain, and this fills in the rest if the read succeeds. */
function signupNotifyDetail(
  sheet: VolunteerSheetDTO | null,
  positionId: string,
): Record<string, string | number | null> {
  const position = sheet?.positions.find((p) => p.id === positionId) ?? null;
  return {
    positionTitle: position?.title ?? null,
    eventTitle: sheet?.event.title ?? null,
    filled: position?.filled ?? 0,
    slots: position?.slots ?? 0,
  };
}

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

  // Pushed HERE, before the reload below, and deliberately so. The spot is
  // already claimed; invariant 5 wants that recorded whatever happens next, and
  // `auditMiddleware` flushes whatever is in `c.var.audit` even when a later
  // line throws — Hono's compose turns a handler error into a response at its
  // own frame, so the middleware's `await next()` still resolves. Pushing after
  // the reload would make the record of a committed write depend on a read that
  // can fail, which is the one thing this log is for.
  //
  // `personId` travels as a ULID, never a name: resolving it is `personLabel`'s
  // job, and that is where the gate an unlisted Person depends on lives
  // (invariants 21 and 22).
  const draft: AuditDraft = {
    action: "volunteer.signup.created",
    entityKind: "volunteer_position",
    entityId: c.req.param("id"),
    detail: { personId },
    notify: { personId, sheetSlug: result.slug! },
  };
  c.var.audit.push(draft);

  const viewer = await viewerOf(c.env, auth.userId, auth.isSystemAdmin);
  const sheet = await loadSheetForMember(c.env, result.slug!, viewer);
  // Same object the array above holds, and the flush runs after this handler
  // returns — so naming the spot is an enrichment of a record that already
  // exists, not a precondition for having one.
  Object.assign(draft.notify!, signupNotifyDetail(sheet, c.req.param("id")));

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

  // Pushed before the reload, for the reason the claim route above gives.
  const draft: AuditDraft = {
    action: "volunteer.signup.deleted",
    entityKind: "volunteer_signup",
    entityId: c.req.param("id"),
    detail: { personId: owner.personId },
    notify: { personId: owner.personId, sheetSlug: owner.slug },
  };
  c.var.audit.push(draft);

  const viewer = await viewerOf(c.env, auth.userId, auth.isSystemAdmin);
  const sheet = await loadSheetForMember(c.env, owner.slug, viewer);
  // The signup row is gone by now, which is why `signupOwner` carried its
  // position id out before the delete.
  Object.assign(draft.notify!, signupNotifyDetail(sheet, owner.positionId));

  return c.json({ sheet });
});
