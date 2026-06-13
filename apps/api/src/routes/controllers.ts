// Shared control: invite a co-Controller (invite + accept), and remove one with
// the last-controller guard (FR-11, FR-12).

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { isController } from "../lib/privacy.js";
import { ulid } from "../lib/ids.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { isoPlus, nowIso, INVITE_TTL } from "../lib/time.js";
import { normalizeEmail } from "../lib/db.js";
import { inviteEmail, sendEmail } from "../lib/email.js";

export const controllers = new Hono<HonoEnv>();

/** POST /persons/:id/controllers { email } — invite a co-Controller. */
controllers.post("/persons/:id/controllers", async (c) => {
  const auth = requireAuth(c);
  const personId = c.req.param("id");
  if (!(await isController(c.env, auth.userId, personId))) {
    return c.json({ error: "forbidden" }, 403);
  }
  const body = await c.req.json<{ email: string }>().catch(() => null);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email.includes("@")) return c.json({ error: "invalid_email" }, 400);

  const token = randomToken();
  const tokenHash = await sha256(token);
  const inviteId = ulid();

  // Record both an invite (status) and a consumable auth_token (kind=invite).
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO control_invite (id, person_id, invited_by, to_email, status, token_hash, expires_at, created_at)
       VALUES (?,?,?,?,'pending',?,?,?)`,
    ).bind(inviteId, personId, auth.userId, email, tokenHash, isoPlus(INVITE_TTL), nowIso()),
    c.env.DB.prepare(
      `INSERT INTO auth_token (id, email, kind, token_hash, person_id, invited_by, reg_open_at_issue, expires_at, created_at)
       VALUES (?,?, 'invite', ?, ?, ?, 1, ?, ?)`,
    ).bind(ulid(), email, tokenHash, personId, auth.userId, isoPlus(INVITE_TTL), nowIso()),
  ]);

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
    detail: { email },
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
