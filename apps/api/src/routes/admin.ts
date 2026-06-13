// Admin: user listing + masquerade (FR-13, SDD §4.1). The broader admin console
// (CSV import, audit-log table, registration toggle UI) is M4.

import { Hono } from "hono";
import type { AuditEntryDTO, BulkImportRow } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { runBulkImport } from "../lib/bulkImport.js";
import { randomSessionId } from "../lib/crypto.js";
import { isoPlus, isExpired, nowIso, MASQUERADE_TTL, SESSION_TTL } from "../lib/time.js";
import { setSessionCookie, clearActivePersonCookie } from "../lib/cookies.js";

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
