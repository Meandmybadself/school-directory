// Authentication: email-only magic links (FR-1..FR-7). The Worker branches on
// account state but responds identically, preventing account enumeration.

import { Hono } from "hono";
import type { Context } from "hono";
import type { AuthStartBody } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { ulid } from "../lib/ids.js";
import { randomToken, randomSessionId, sha256 } from "../lib/crypto.js";
import { isoPlus, isExpired, nowIso, MAGIC_LINK_TTL, SESSION_TTL } from "../lib/time.js";
import { magicLinkEmail, sendEmail } from "../lib/email.js";
import { findUserByEmail, isRegistrationOpen, normalizeEmail } from "../lib/db.js";
import { setSessionCookie, clearSessionCookie, SESSION_COOKIE } from "../lib/cookies.js";
import { getCookie } from "hono/cookie";

export const auth = new Hono<HonoEnv>();

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL / 1000);

/** POST /auth/start — issue a magic link, or silently no-op. Always 200. */
auth.post("/start", async (c) => {
  const body = await c.req.json<AuthStartBody>().catch(() => null);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email || !email.includes("@")) {
    // Even malformed input gets the neutral response shape (after a soft check).
    return c.json({ ok: true });
  }

  const user = await findUserByEmail(c.env, email);
  const regOpen = await isRegistrationOpen(c.env);

  if (user || regOpen) {
    const token = randomToken();
    const tokenHash = await sha256(token);
    await c.env.DB.prepare(
      `INSERT INTO auth_token (id, email, kind, token_hash, reg_open_at_issue, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(ulid(), email, "signin", tokenHash, regOpen ? 1 : 0, isoPlus(MAGIC_LINK_TTL), nowIso())
      .run();

    const apiOrigin = new URL(c.req.url).origin;
    const link = `${apiOrigin}/auth/callback?t=${token}`;
    const msg = magicLinkEmail(c.env, link);
    msg.to = email;
    c.executionCtx.waitUntil(sendEmail(c.env, msg));
  }

  // Identical response whether or not anything was sent.
  return c.json({ ok: true });
});

/** GET /auth/callback?t=… — consume token, create session, redirect to the SPA. */
auth.get("/callback", async (c) => {
  const token = c.req.query("t");
  const fail = () => c.redirect(`${c.env.APP_URL}/sign-in?error=link`, 302);
  if (!token) return fail();

  const tokenHash = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT id, email, kind, person_id, invited_by, reg_open_at_issue, expires_at, consumed_at
     FROM auth_token WHERE token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      email: string;
      kind: string;
      person_id: string | null;
      invited_by: string | null;
      reg_open_at_issue: number;
      expires_at: string;
      consumed_at: string | null;
    }>();

  if (!row || row.consumed_at || isExpired(row.expires_at)) return fail();

  // Single-use: mark consumed immediately.
  await c.env.DB.prepare("UPDATE auth_token SET consumed_at = ? WHERE id = ?")
    .bind(nowIso(), row.id)
    .run();

  // Find or create the user.
  let user = await findUserByEmail(c.env, row.email);
  if (!user) {
    // signin tokens only create a user if registration was open at issue time.
    // invite tokens always create the user (they bypass the toggle).
    if (row.kind === "signin" && row.reg_open_at_issue !== 1) return fail();
    const userId = ulid();
    await c.env.DB.prepare(
      `INSERT INTO user (id, email, email_verified_at, created_at) VALUES (?,?,?,?)`,
    )
      .bind(userId, row.email, nowIso(), nowIso())
      .run();
    user = { id: userId, email: row.email, is_system_admin: 0, locale: null };
  } else {
    await c.env.DB.prepare("UPDATE user SET email_verified_at = ? WHERE id = ?")
      .bind(nowIso(), user.id)
      .run();
  }

  // Invite binding: grant control + close the invite.
  if (row.kind === "invite" && row.person_id) {
    await bindInvite(c, user.id, row.person_id, row.invited_by, row.email);
  }

  // Create the session.
  const sessionId = randomSessionId();
  await c.env.DB.prepare(
    `INSERT INTO session (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(
      sessionId,
      user.id,
      nowIso(),
      nowIso(),
      isoPlus(SESSION_TTL),
      c.var.userAgent,
      c.var.ip,
    )
    .run();
  setSessionCookie(c, sessionId, SESSION_TTL_SECONDS);

  c.var.audit.push({ action: "auth.signin", entityKind: "user", entityId: user.id });

  return c.redirect(`${c.env.APP_URL}/`, 302);
});

async function bindInvite(
  c: Context<HonoEnv>,
  userId: string,
  personId: string,
  invitedBy: string | null,
  email: string,
): Promise<void> {
  const exists = await c.env.DB.prepare(
    "SELECT 1 AS ok FROM control WHERE user_id = ? AND person_id = ? LIMIT 1",
  )
    .bind(userId, personId)
    .first<{ ok: number }>();
  if (!exists) {
    await c.env.DB.prepare(
      "INSERT INTO control (user_id, person_id, granted_by, since) VALUES (?,?,?,?)",
    )
      .bind(userId, personId, invitedBy, nowIso())
      .run();
  }
  await c.env.DB.prepare(
    "UPDATE control_invite SET status = 'accepted' WHERE person_id = ? AND to_email = ? AND status = 'pending'",
  )
    .bind(personId, email)
    .run();
  c.var.audit.push({ action: "invite.accepted", entityKind: "person", entityId: personId });
  c.var.audit.push({
    action: "control.granted",
    entityKind: "person",
    entityId: personId,
    detail: { userId },
  });
}

/** POST /auth/signout — revoke the current session. */
auth.post("/signout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) {
    await c.env.DB.prepare("UPDATE session SET revoked_at = ? WHERE id = ?")
      .bind(nowIso(), sid)
      .run();
    if (c.var.auth) {
      c.var.audit.push({ action: "auth.signout", entityKind: "user", entityId: c.var.auth.userId });
    }
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});
