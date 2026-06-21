// Admin: user listing + masquerade (FR-13, SDD §4.1). The broader admin console
// (CSV import, audit-log table, registration toggle UI) is M4.

import { Hono } from "hono";
import type { AuditEntryDTO, BulkImportRow, CalendarSourceDTO, CalendarSourceInput } from "@sd/shared";
import type { Env, HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { runBulkImport } from "../lib/bulkImport.js";
import { refreshSource, refreshAllSources } from "../lib/calendar.js";
import { randomSessionId, randomToken, sha256 } from "../lib/crypto.js";
import { ulid } from "../lib/ids.js";
import { isoPlus, isExpired, nowIso, MAGIC_LINK_TTL, MASQUERADE_TTL, SESSION_TTL } from "../lib/time.js";
import { setSessionCookie, clearActivePersonCookie } from "../lib/cookies.js";
import { findUserByEmail, normalizeEmail } from "../lib/db.js";
import { magicLinkEmail, sendEmail } from "../lib/email.js";

export const admin = new Hono<HonoEnv>();

/** GET /admin/users — directory of Users (system admins only). */
admin.get("/users", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.is_system_admin,
            (SELECT COUNT(*) FROM control ctl WHERE ctl.user_id = u.id) AS person_count
     FROM user u WHERE u.disabled_at IS NULL ORDER BY u.email`,
  ).all<{ id: string; email: string; is_system_admin: number; person_count: number }>();
  return c.json({
    users: rows.results.map((u) => ({
      id: u.id,
      email: u.email,
      isSystemAdmin: u.is_system_admin === 1,
      personCount: u.person_count,
    })),
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
  await c.env.DB.prepare(
    "INSERT INTO user (id, email, is_system_admin, created_at) VALUES (?,?,?,?)",
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

/** POST /admin/bulk-import { rows, dryRun } — CSV bulk import (FR-29/30). */
admin.post("/bulk-import", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<{ rows: BulkImportRow[]; dryRun?: boolean }>().catch(() => null);
  if (!body || !Array.isArray(body.rows)) return c.json({ error: "invalid_body" }, 400);

  const dryRun = body.dryRun !== false; // default to a safe dry-run
  const result = await runBulkImport(c.env, body.rows, dryRun);
  if (!dryRun) {
    c.var.audit.push({
      action: "bulk.import",
      entityKind: "import",
      entityId: null,
      detail: {
        rows: result.rowsProcessed,
        personsCreated: result.personsCreated,
        groupsCreated: result.groupsCreated,
        invitesQueued: result.invitesQueued,
      },
    });
  }
  return c.json(result);
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
