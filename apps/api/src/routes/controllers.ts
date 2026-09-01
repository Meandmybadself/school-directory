// Shared control: invite a co-Controller (invite + accept), and remove one with
// the last-controller guard (FR-11, FR-12).

import { Hono } from "hono";
import type { InviteControllerBody } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { isoPlus, nowIso, INVITE_TTL } from "../lib/time.js";
import { normalizeEmail } from "../lib/db.js";
import { inviteEmail, sendEmail } from "../lib/email.js";

export const controllers = new Hono<HonoEnv>();

/** POST /persons/:id/controllers { email, householdId? } — invite a co-Controller.
 *
 *  `householdId` widens what accepting the invitation grants: control of every
 *  Person in that household the INVITER controls, plus admin of the household
 *  itself. It is the difference between "help me manage this one child" and
 *  "you are the other parent here", and only the second one stops a co-parent
 *  arriving to an empty family and re-creating children who already exist — see
 *  migration 0021. It is opt-in per call site rather than implied by the
 *  Person's memberships, because widening someone's sight of a family is the
 *  inviter's decision to make explicitly, not a side effect of where the Person
 *  happens to belong. */
controllers.post("/persons/:id/controllers", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = await c.req.json<InviteControllerBody>().catch(() => null);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email.includes("@")) return c.json({ error: "invalid_email" }, 400);

  // The same authority POST /me/persons requires to place someone in a
  // household: you administer it, via a Person you control. Anything less would
  // let a member hand out sight of a family that isn't theirs.
  let householdId: string | null = null;
  if (body?.householdId) {
    const admins = await c.env.DB.prepare(
      `SELECT 1 AS ok FROM grp g
       JOIN membership m ON m.group_id = g.id AND m.is_admin = 1
       JOIN control ctl ON ctl.person_id = m.person_id
       WHERE g.id = ? AND g.kind = 'household' AND ctl.user_id = ? LIMIT 1`,
    )
      .bind(body.householdId, auth.userId)
      .first<{ ok: number }>();
    if (!admins) return c.json({ error: "forbidden_household" }, 403);
    householdId = body.householdId;
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const inviteId = ulid();

  // Record both an invite (status) and a consumable auth_token (kind=invite).
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO control_invite (id, person_id, invited_by, to_email, status, token_hash, group_id, expires_at, created_at)
       VALUES (?,?,?,?,'pending',?,?,?,?)`,
    ).bind(inviteId, personId, auth.userId, email, tokenHash, householdId, isoPlus(INVITE_TTL), nowIso()),
    c.env.DB.prepare(
      `INSERT INTO auth_token (id, email, kind, token_hash, person_id, invited_by, group_id, reg_open_at_issue, expires_at, created_at)
       VALUES (?,?, 'invite', ?, ?, ?, ?, 1, ?, ?)`,
    ).bind(ulid(), email, tokenHash, personId, auth.userId, householdId, isoPlus(INVITE_TTL), nowIso()),
  ]);

  // UNLISTED-EXEMPT: single row by id, already isController-gated above — a
  // Controller is one of the two audiences the gate admits anyway.
  const person = await c.env.DB.prepare("SELECT first_name, last_name FROM person WHERE id = ?")
    .bind(personId)
    .first<{ first_name: string; last_name: string | null }>();
  const inviter = await c.env.DB.prepare("SELECT email FROM user WHERE id = ?")
    .bind(auth.userId)
    .first<{ email: string }>();

  const apiOrigin = new URL(c.req.url).origin;
  const link = `${apiOrigin}/auth/callback?t=${token}`;
  const personName = person ? `${person.first_name} ${person.last_name ?? ""}`.trim() : "a member";
  const msg = inviteEmail(c.env, link, inviter?.email ?? "A member", personName);
  msg.to = email;
  c.executionCtx.waitUntil(sendEmail(c.env, msg));

  c.var.audit.push({
    action: "invite.sent",
    entityKind: "person",
    entityId: personId,
    detail: { email, householdId },
    // The Person is `entityId`; the formatter resolves the name through the
    // gate rather than being handed one (invariants 21 and 22). `household` is
    // a boolean rather than the id: a channel wants to know this invitation
    // hands over a whole family, not which row it is.
    notify: { email, household: householdId !== null },
  });
  return c.json({ ok: true, inviteId }, 201);
});

/**
 * DELETE /persons/:id/controllers/:userId — remove a Controller.
 * Guards against removing the last remaining Controller (FR-12).
 */
controllers.delete("/persons/:id/controllers/:userId", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  const targetUserId = c.req.param("userId");

  // Only a current controller (or admin) may remove controllers.
  if (!(await isController(c.env, auth.userId, personId)) && !auth.isSystemAdmin) {
    return c.json({ error: "forbidden" }, 403);
  }

  const countRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM control WHERE person_id = ?",
  )
    .bind(personId)
    .first<{ n: number }>();
  const isTargetController = await isController(c.env, targetUserId, personId);
  if (!isTargetController) return c.json({ error: "not_found" }, 404);

  if ((countRow?.n ?? 0) <= 1) {
    // Last-controller guard: refuse, instruct caller to add a replacement first.
    return c.json({ error: "last_controller", message: "Add another controller before removing the last one." }, 409);
  }

  await c.env.DB.prepare("DELETE FROM control WHERE person_id = ? AND user_id = ?")
    .bind(personId, targetUserId)
    .run();

  c.var.audit.push({
    action: "control.revoked",
    entityKind: "person",
    entityId: personId,
    detail: { userId: targetUserId },
  });
  return c.json({ ok: true });
});
