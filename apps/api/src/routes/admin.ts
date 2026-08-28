// Admin: user listing + masquerade (FR-13, SDD §4.1). The broader admin console
// (CSV import, audit-log table, registration toggle UI) is M4.

import { Hono } from "hono";
import type { AuditEntryDTO, BulkImportRow, CalendarSourceDTO, CalendarSourceInput, GroupKind } from "@sd/shared";
import type { Env, HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { verifyAuditChain } from "../lib/audit.js";
import { runBulkImport } from "../lib/bulkImport.js";
import { refreshSource, refreshAllSources } from "../lib/calendar.js";
import { randomSessionId, randomToken, sha256 } from "../lib/crypto.js";
import { ulid } from "../lib/ids.js";
import { isoPlus, isExpired, nowIso, MAGIC_LINK_TTL, MASQUERADE_TTL, SESSION_TTL } from "../lib/time.js";
import { setSessionCookie, clearActivePersonCookie } from "../lib/cookies.js";
import { findUserByEmail, normalizeEmail } from "../lib/db.js";
import { magicLinkEmail, directoryInviteEmail, sendEmail } from "../lib/email.js";
import type { QueuedInvite } from "../lib/bulkImport.js";

export const admin = new Hono<HonoEnv>();

/** Email bulk-import sign-in links in small batches so a large import doesn't
 *  fire thousands of Resend calls at once. Failures are swallowed by sendEmail. */
async function sendBulkInvites(env: Env, origin: string, invites: QueuedInvite[]): Promise<void> {
  const CONCURRENCY = 5;
  for (let i = 0; i < invites.length; i += CONCURRENCY) {
    await Promise.all(
      invites.slice(i, i + CONCURRENCY).map((inv) => {
        const msg = directoryInviteEmail(env, `${origin}/auth/callback?t=${inv.token}`, inv.personName);
        msg.to = inv.email;
        return sendEmail(env, msg);
      }),
    );
  }
}

/** GET /admin/users — directory of Users (system admins only).
 *
 *  Disabled accounts are INCLUDED, flagged. They used to be filtered out, which
 *  was fine while nothing could disable one — but an account you cannot see is
 *  an account you cannot re-enable, and disabling is meant to be reversible.
 *  Active first, so the working list stays at the top. */
admin.get("/users", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_system_admin, u.disabled_at,
            (SELECT COUNT(*) FROM control ctl WHERE ctl.user_id = u.id) AS person_count
     FROM user u
     ORDER BY (u.disabled_at IS NOT NULL), u.email`,
  ).all<{
    id: string;
    email: string;
    is_system_admin: number;
    disabled_at: string | null;
    person_count: number;
  }>();
  return c.json({
    users: rows.results.map((u) => ({
      id: u.id,
      email: u.email,
      isSystemAdmin: u.is_system_admin === 1,
      personCount: u.person_count,
      disabled: u.disabled_at !== null,
      disabledAt: u.disabled_at,
    })),
  });
});

/** POST /admin/users/:id/disabled { disabled } — take an account out of use, or
 *  put it back.
 *
 *  Deliberately reversible, and deliberately the ONLY destructive-feeling thing
 *  here: it touches the `user` row and nothing else. Their Persons, households,
 *  contact items and audit trail are all left exactly as they were, because
 *  "this person left the school" and "erase what they built" are different
 *  requests and only the second one is unrecoverable. Everything that matters
 *  already honours `disabled_at` — sessions (middleware/session.ts), the
 *  newsletter audience (lib/newsletter.ts) and masquerade (below) — so the
 *  account stops working the moment this lands.
 *
 *  Sessions are deleted rather than left to expire. The session lookup already
 *  refuses a disabled user, so this changes no security property; it makes
 *  "signed out everywhere" true rather than merely effective, and stops a
 *  re-enable from silently restoring a year-old cookie. */
admin.post("/users/:id/disabled", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  // Same rule as changing a role: acting *as* somebody must never become a way
  // to lock them out under their own name.
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const id = c.req.param("id");
  const body = await c.req.json<{ disabled?: boolean }>().catch(() => null);
  if (typeof body?.disabled !== "boolean") return c.json({ error: "invalid_body" }, 400);
  // No self-disable. It is the one move that can empty the admin set — and
  // since you cannot disable yourself, at least one admin always remains.
  if (id === auth.userId) return c.json({ error: "cannot_disable_self" }, 400);

  const target = await c.env.DB.prepare("SELECT id, email, disabled_at FROM user WHERE id = ?")
    .bind(id)
    .first<{ id: string; email: string; disabled_at: string | null }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const alreadyDisabled = target.disabled_at !== null;
  if (alreadyDisabled === body.disabled) {
    // Idempotent: a double click should not read as a failure.
    return c.json({ ok: true, disabled: alreadyDisabled, disabledAt: target.disabled_at });
  }

  const disabledAt = body.disabled ? nowIso() : null;

  // Never disable the last enabled admin. "You cannot disable yourself" is not
  // enough on its own: two admins can each disable the OTHER, and if both land
  // there is no admin left, no route that clears disabled_at without an admin
  // session, and no way back in — a bootstrap-admin email re-grants the role on
  // sign-in but never un-disables the row, so recovery means opening D1 by hand.
  //
  // The count lives INSIDE the UPDATE rather than in a preceding SELECT because
  // D1 gives no transaction across a read-then-write; SQLite serializes the two
  // writes, so whichever lands second sees the first and matches no rows. Same
  // guarded-write-plus-meta.changes shape as the volunteer overfill check.
  const update = body.disabled
    ? await c.env.DB.prepare(
        `UPDATE user SET disabled_at = ?
          WHERE id = ?
            AND (is_system_admin = 0
                 OR EXISTS (SELECT 1 FROM user other
                             WHERE other.is_system_admin = 1
                               AND other.disabled_at IS NULL
                               AND other.id <> ?))`,
      )
        .bind(disabledAt, id, id)
        .run()
    : await c.env.DB.prepare("UPDATE user SET disabled_at = NULL WHERE id = ?").bind(id).run();

  if (update.meta.changes === 0) {
    // The row exists (checked above), so the guard is what refused.
    return c.json(
      { error: "last_admin", message: "That's the only admin left. Make someone else an admin first." },
      409,
    );
  }

  if (body.disabled) {
    // `OR acting_admin_id` is the load-bearing half. A masquerade session's
    // user_id is the person being impersonated, NOT the admin doing it, so
    // matching on user_id alone would leave a disabled admin browsing as
    // somebody else until the masquerade aged out an hour later — the exact
    // access this is meant to cut off.
    await c.env.DB.prepare("DELETE FROM session WHERE user_id = ? OR acting_admin_id = ?")
      .bind(id, id)
      .run();
  }

  c.var.audit.push({
    action: "admin.action",
    entityKind: "user",
    entityId: id,
    detail: { op: body.disabled ? "user.disabled" : "user.enabled", email: target.email },
  });

  return c.json({ ok: true, disabled: body.disabled, disabledAt });
});

/** GET /admin/users/:id/impact — what permanently deleting this User would
 *  remove. READ ONLY: it writes nothing and deletes nothing.
 *
 *  It exists because the obvious reading of "delete a user and everything they
 *  made" cannot be answered by this schema, and the plausible-looking guesses
 *  destroy other people's data:
 *
 *    `grp` has no creator column at all, so "groups they created" is not
 *    recorded anywhere. The nearest proxy is "groups a Person they control
 *    administers" — which for a teacher is a classroom full of other families'
 *    children. Those are never deletion candidates here.
 *
 *    `control` is many-to-many on purpose (SDD: two parents, one child), so
 *    "their people" splits in two. A Person somebody else also controls is not
 *    theirs to take; only a Person left with no controller at all is, because
 *    nobody could sign in and edit it afterwards.
 *
 *  An admin reads this before anything irreversible happens. */
admin.get("/users/:id/impact", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");

  const user = await c.env.DB.prepare("SELECT id, email, disabled_at FROM user WHERE id = ?")
    .bind(id)
    .first<{ id: string; email: string; disabled_at: string | null }>();
  if (!user) return c.json({ error: "not_found" }, 404);

  // Every Person they control, with how many OTHER users also control them.
  const people = await c.env.DB.prepare(
    `SELECT p.id, p.first_name, p.last_name,
            (SELECT COUNT(*) FROM control c2 WHERE c2.person_id = p.id AND c2.user_id <> ?) AS others
       FROM control c
       JOIN person p ON p.id = c.person_id
      WHERE c.user_id = ?
      ORDER BY p.first_name`,
  )
    .bind(id, id)
    .all<{ id: string; first_name: string; last_name: string | null; others: number }>();

  const nameOf = (r: { first_name: string; last_name: string | null }) =>
    [r.first_name, r.last_name].filter(Boolean).join(" ");

  const orphanedPersons = people.results
    .filter((r) => r.others === 0)
    .map((r) => ({ id: r.id, name: nameOf(r) }));
  const sharedPersons = people.results
    .filter((r) => r.others > 0)
    .map((r) => ({ id: r.id, name: nameOf(r), otherControllers: r.others }));

  // Households whose every member is among the orphans — nobody would be left
  // in them. A household that still has somebody in it stays, address and all.
  const emptiedHouseholds: { id: string; name: string }[] = [];
  if (orphanedPersons.length > 0) {
    const marks = orphanedPersons.map(() => "?").join(",");
    const ids = orphanedPersons.map((p) => p.id);
    const rows = await c.env.DB.prepare(
      `SELECT g.id, g.name
         FROM grp g
        WHERE g.kind = 'household'
          AND EXISTS (SELECT 1 FROM membership m
                       WHERE m.group_id = g.id AND m.person_id IN (${marks}))
          AND NOT EXISTS (SELECT 1 FROM membership m2
                           WHERE m2.group_id = g.id AND m2.person_id NOT IN (${marks}))
        ORDER BY g.name`,
    )
      .bind(...ids, ...ids)
      .all<{ id: string; name: string }>();
    emptiedHouseholds.push(...rows.results);
  }

  // Classrooms and generic groups they administer. Reported, never deleted.
  const retained = await c.env.DB.prepare(
    `SELECT DISTINCT g.id, g.name, g.kind
       FROM membership m
       JOIN grp g ON g.id = m.group_id
       JOIN control c ON c.person_id = m.person_id
      WHERE c.user_id = ? AND m.is_admin = 1 AND g.kind <> 'household'
      ORDER BY g.name`,
  )
    .bind(id)
    .all<{ id: string; name: string; kind: GroupKind }>();

  const audit = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE actor_user_id = ? OR masquerading_as = ?",
  )
    .bind(id, id)
    .first<{ n: number }>();

  return c.json({
    user: { id: user.id, email: user.email, disabled: user.disabled_at !== null },
    orphanedPersons,
    sharedPersons,
    emptiedHouseholds,
    retainedGroupsAdministered: retained.results,
    auditEntries: audit?.n ?? 0,
  });
});

/** POST /admin/users { email, isSystemAdmin?, sendEmail? } — create a sign-in
 *  account. The account exists immediately (so they can sign in even when
 *  registration is closed). A sign-in link is emailed unless sendEmail is false;
 *  either way they can later request one themselves via "Email me a link". */
admin.post("/users", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ email: string; isSystemAdmin?: boolean; sendEmail?: boolean }>().catch(() => null);
  const email = body?.email ? normalizeEmail(body.email) : "";
  if (!email.includes("@")) return c.json({ error: "invalid_email" }, 400);
  if (await findUserByEmail(c.env, email)) return c.json({ error: "user_exists" }, 409);

  const id = ulid();
  // joined_via 'admin' keeps this out of new-member notifications — whoever is
  // creating the account doesn't need an email telling them it happened.
  await c.env.DB.prepare(
    "INSERT INTO user (id, email, is_system_admin, created_at, joined_via) VALUES (?,?,?,?, 'admin')",
  )
    .bind(id, email, body?.isSystemAdmin ? 1 : 0, nowIso())
    .run();

  const sendInvite = body?.sendEmail !== false;
  if (sendInvite) {
    const token = randomToken();
    const tokenHash = await sha256(token);
    await c.env.DB.prepare(
      `INSERT INTO auth_token (id, email, kind, token_hash, reg_open_at_issue, expires_at, created_at)
       VALUES (?,?, 'signin', ?, 1, ?, ?)`,
    )
      .bind(ulid(), email, tokenHash, isoPlus(MAGIC_LINK_TTL), nowIso())
      .run();
    const link = `${new URL(c.req.url).origin}/auth/callback?t=${token}`;
    const msg = magicLinkEmail(c.env, link);
    msg.to = email;
    c.executionCtx.waitUntil(sendEmail(c.env, msg));
  }

  c.var.audit.push({
    action: "admin.action",
    entityKind: "user",
    entityId: id,
    detail: { op: "user.create", emailSent: sendInvite },
  });
  return c.json({ user: { id, email, isSystemAdmin: !!body?.isSystemAdmin, personCount: 0 } }, 201);
});

/** PATCH /admin/users/:id { isSystemAdmin } — grant or revoke system admin. */
admin.patch("/users/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  // The one admin op a masquerade session never gets: acting *as* someone must
  // not become a route to handing out privileges under their name.
  if (auth.isMasquerading) return c.json({ error: "forbidden_while_masquerading" }, 403);

  const id = c.req.param("id");
  const body = await c.req.json<{ isSystemAdmin?: boolean }>().catch(() => null);
  if (typeof body?.isSystemAdmin !== "boolean") return c.json({ error: "invalid_body" }, 400);
  // No self-demotion: it's the only way to lock every admin out of the console,
  // and it keeps "remove admin" from ever emptying the admin set.
  if (id === auth.userId) return c.json({ error: "cannot_change_own_role" }, 400);

  const target = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_system_admin,
            (SELECT COUNT(*) FROM control ctl WHERE ctl.user_id = u.id) AS person_count
     FROM user u WHERE u.id = ? AND u.disabled_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; email: string; is_system_admin: number; person_count: number }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const next = body.isSystemAdmin;
  if ((target.is_system_admin === 1) !== next) {
    await c.env.DB.prepare("UPDATE user SET is_system_admin = ? WHERE id = ?").bind(next ? 1 : 0, id).run();
    c.var.audit.push({
      action: "admin.action",
      entityKind: "user",
      entityId: id,
      detail: { op: next ? "user.admin.granted" : "user.admin.revoked", email: target.email },
    });
  }
  return c.json({
    user: { id: target.id, email: target.email, isSystemAdmin: next, personCount: target.person_count },
  });
});

/** POST /admin/bulk-import { rows, dryRun } — CSV bulk import (FR-29/30). */
admin.post("/bulk-import", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ rows: BulkImportRow[]; dryRun?: boolean; sendInvites?: boolean }>().catch(() => null);
  if (!body || !Array.isArray(body.rows)) return c.json({ error: "invalid_body" }, 400);

  const dryRun = body.dryRun !== false; // default to a safe dry-run
  const sendInvites = body.sendInvites === true; // opt-in: email new members a sign-in link
  const { result, invites } = await runBulkImport(c.env, body.rows, dryRun);
  if (!dryRun) {
    const emailsSent = sendInvites ? invites.length : 0;
    if (emailsSent > 0) {
      c.executionCtx.waitUntil(sendBulkInvites(c.env, new URL(c.req.url).origin, invites));
    }
    c.var.audit.push({
      action: "bulk.import",
      entityKind: "import",
      entityId: null,
      detail: {
        rows: result.rowsProcessed,
        personsCreated: result.personsCreated,
        groupsCreated: result.groupsCreated,
        invitesQueued: result.invitesQueued,
        emailsSent,
      },
    });
  }
  return c.json(result);
});

/**
 * GET /admin/audit/verify?limit= — re-derive the hash chain (invariant 5).
 *
 * The chain was written from the start and read by nothing, which made the
 * tamper evidence a claim rather than a check — and hid the fork that migration
 * 0016 fixes. This is that check. It walks the log, re-hashes every row and
 * reports the positions that don't reconcile: a `hash` break means a row's
 * contents were altered, a `link` break means its parent doesn't match, a `gap`
 * means a row was removed.
 *
 * Registered ABOVE `/audit` so Hono doesn't route "verify" into that handler's
 * query-string world. Cheap enough to run by hand after anything alarming; not
 * on a cron, because nobody reads a green cron.
 */
admin.get("/audit/verify", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const limit = Number.parseInt(c.req.query("limit") ?? "5000", 10) || 5000;
  return c.json(await verifyAuditChain(c.env, { limit }));
});

/** GET /admin/audit?action=&limit=&before= — append-only audit log (FR-32). */
admin.get("/audit", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const action = c.req.query("action");
  const before = c.req.query("before"); // id cursor; rows are ULID-ordered
  const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (action) { where.push("a.action = ?"); binds.push(action); }
  if (before) { where.push("a.id < ?"); binds.push(before); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.entity_kind, a.entity_id, a.ip, a.created_at,
            actor.email AS actor_email, masq.email AS masq_email
     FROM audit_log a
     LEFT JOIN user actor ON actor.id = a.actor_user_id
     LEFT JOIN user masq  ON masq.id  = a.masquerading_as
     ${whereSql}
     ORDER BY a.id DESC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<{
      id: string; action: string; entity_kind: string | null; entity_id: string | null;
      ip: string | null; created_at: string; actor_email: string | null; masq_email: string | null;
    }>();

  const entries: AuditEntryDTO[] = rows.results.map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actor_email,
    masqueradingAsEmail: r.masq_email,
    entityKind: r.entity_kind,
    entityId: r.entity_id,
    ip: r.ip,
    createdAt: r.created_at,
  }));
  return c.json({ entries, nextBefore: entries.length === limit ? entries[entries.length - 1]?.id : null });
});

/** POST /admin/masquerade { userId } — start viewing as another User. */
admin.post("/masquerade", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  if (auth.isMasquerading) return c.json({ error: "already_masquerading" }, 409);

  const body = await c.req.json<{ userId: string }>().catch(() => null);
  if (!body?.userId) return c.json({ error: "invalid_body" }, 400);
  if (body.userId === auth.userId) return c.json({ error: "cannot_masquerade_self" }, 400);

  const target = await c.env.DB.prepare(
    "SELECT id FROM user WHERE id = ? AND disabled_at IS NULL",
  )
    .bind(body.userId)
    .first<{ id: string }>();
  if (!target) return c.json({ error: "not_found" }, 404);

  const sessionId = randomSessionId();
  await c.env.DB.prepare(
    `INSERT INTO session (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip, acting_admin_id, parent_session_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
    .bind(sessionId, target.id, nowIso(), nowIso(), isoPlus(MASQUERADE_TTL), c.var.userAgent, c.var.ip, auth.userId, auth.sessionId)
    .run();

  setSessionCookie(c, sessionId, Math.floor(MASQUERADE_TTL / 1000));
  clearActivePersonCookie(c); // resolve the target's own first Person

  c.var.audit.push({ action: "masquerade.start", entityKind: "user", entityId: target.id });
  return c.json({ ok: true });
});

/** POST /admin/masquerade/stop — return to the admin's own session. */
admin.post("/masquerade/stop", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isMasquerading) return c.json({ error: "not_masquerading" }, 400);

  const current = await c.env.DB.prepare(
    "SELECT parent_session_id FROM session WHERE id = ?",
  )
    .bind(auth.sessionId)
    .first<{ parent_session_id: string | null }>();

  // Revoke the masquerade session.
  await c.env.DB.prepare("UPDATE session SET revoked_at = ? WHERE id = ?")
    .bind(nowIso(), auth.sessionId)
    .run();

  // Restore the admin's original session if still valid; else mint a fresh one.
  let restoreId = current?.parent_session_id ?? null;
  if (restoreId) {
    const parent = await c.env.DB.prepare(
      "SELECT expires_at, revoked_at FROM session WHERE id = ?",
    )
      .bind(restoreId)
      .first<{ expires_at: string; revoked_at: string | null }>();
    if (!parent || parent.revoked_at || isExpired(parent.expires_at)) restoreId = null;
  }
  if (!restoreId) {
    restoreId = randomSessionId();
    await c.env.DB.prepare(
      `INSERT INTO session (id, user_id, created_at, last_seen_at, expires_at, user_agent, ip)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(restoreId, auth.realUserId, nowIso(), nowIso(), isoPlus(SESSION_TTL), c.var.userAgent, c.var.ip)
      .run();
  }
  setSessionCookie(c, restoreId, Math.floor(SESSION_TTL / 1000));
  clearActivePersonCookie(c);

  c.var.audit.push({ action: "masquerade.stop", entityKind: "user", entityId: auth.userId });
  return c.json({ ok: true });
});

// ── Calendar sources (system admins) ─────────────────────────────────────────

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface SourceRow {
  id: string;
  url: string;
  name: string;
  color: string;
  enabled: number;
  last_fetched_at: string | null;
  last_status: string | null;
  last_error: string | null;
  event_count: number;
}

function toSourceDTO(r: SourceRow): CalendarSourceDTO {
  return {
    id: r.id,
    url: r.url,
    name: r.name,
    color: r.color,
    enabled: r.enabled === 1,
    lastFetchedAt: r.last_fetched_at,
    lastStatus: (r.last_status as CalendarSourceDTO["lastStatus"]) ?? null,
    lastError: r.last_error,
    eventCount: r.event_count,
  };
}

async function loadSource(env: Env, id: string): Promise<CalendarSourceDTO | null> {
  const row = await env.DB.prepare(
    `SELECT s.id, s.url, s.name, s.color, s.enabled, s.last_fetched_at, s.last_status, s.last_error,
            (SELECT COUNT(*) FROM calendar_event e WHERE e.source_id = s.id) AS event_count
     FROM calendar_source s WHERE s.id = ?`,
  )
    .bind(id)
    .first<SourceRow>();
  return row ? toSourceDTO(row) : null;
}

/** GET /admin/calendar-sources — list ICS feeds with status + event counts. */
admin.get("/calendar-sources", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.url, s.name, s.color, s.enabled, s.last_fetched_at, s.last_status, s.last_error,
            (SELECT COUNT(*) FROM calendar_event e WHERE e.source_id = s.id) AS event_count
     FROM calendar_source s ORDER BY s.name COLLATE NOCASE`,
  ).all<SourceRow>();
  return c.json({ sources: rows.results.map(toSourceDTO) });
});

/** POST /admin/calendar-sources { url, name, color? } — add a feed and fetch it
 *  immediately so events show without waiting for the next cron run. */
admin.post("/calendar-sources", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<CalendarSourceInput>().catch(() => null);
  const url = body?.url?.trim();
  const name = body?.name?.trim();
  if (!url || !/^https?:\/\//i.test(url) || !name) return c.json({ error: "invalid_body" }, 400);
  const color = body?.color && HEX_COLOR.test(body.color) ? body.color : "#0068A8";

  const id = ulid();
  await c.env.DB.prepare(
    "INSERT INTO calendar_source (id, url, name, color, enabled, created_at) VALUES (?,?,?,?,1,?)",
  )
    .bind(id, url, name, color, nowIso())
    .run();

  await refreshSource(c.env, { id, url }); // immediate first fetch
  c.var.audit.push({ action: "calendar.source.created", entityKind: "calendar_source", entityId: id, detail: { url } });
  return c.json({ source: await loadSource(c.env, id) }, 201);
});

/** PATCH /admin/calendar-sources/:id { url?, name?, color?, enabled? }. */
admin.patch("/calendar-sources/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id, url, enabled FROM calendar_source WHERE id = ?")
    .bind(id)
    .first<{ id: string; url: string; enabled: number }>();
  if (!existing) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<CalendarSourceInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  let nextUrl = existing.url;
  if (typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim())) {
    nextUrl = body.url.trim();
    sets.push("url = ?");
    binds.push(nextUrl);
  }
  if (typeof body.name === "string" && body.name.trim()) {
    sets.push("name = ?");
    binds.push(body.name.trim());
  }
  if (typeof body.color === "string" && HEX_COLOR.test(body.color)) {
    sets.push("color = ?");
    binds.push(body.color);
  }
  let enablingNow = false;
  if (typeof body.enabled === "boolean") {
    sets.push("enabled = ?");
    binds.push(body.enabled ? 1 : 0);
    enablingNow = body.enabled && existing.enabled !== 1;
  }
  if (!sets.length) return c.json({ error: "nothing_to_update" }, 400);
  binds.push(id);
  await c.env.DB.prepare(`UPDATE calendar_source SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();

  // Re-fetch when the URL changed or the feed was just (re-)enabled.
  if (nextUrl !== existing.url || enablingNow) await refreshSource(c.env, { id, url: nextUrl });
  // Clear events if disabled.
  if (body.enabled === false) await c.env.DB.prepare("DELETE FROM calendar_event WHERE source_id = ?").bind(id).run();

  c.var.audit.push({ action: "calendar.source.updated", entityKind: "calendar_source", entityId: id });
  return c.json({ source: await loadSource(c.env, id) });
});

/** DELETE /admin/calendar-sources/:id — remove a feed and its events. */
admin.delete("/calendar-sources/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const res = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM calendar_event WHERE source_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM calendar_source WHERE id = ?").bind(id),
  ]);
  if (!res[1]?.meta.changes) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({ action: "calendar.source.deleted", entityKind: "calendar_source", entityId: id });
  return c.json({ ok: true });
});

/** POST /admin/calendar-sources/refresh — fetch all enabled feeds now. */
admin.post("/calendar-sources/refresh", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const result = await refreshAllSources(c.env);
  c.var.audit.push({ action: "calendar.refreshed", entityKind: "calendar_source", entityId: null, detail: result });
  return c.json({ ok: true, ...result });
});
