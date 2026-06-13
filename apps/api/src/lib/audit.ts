// Append-only audit log (FR-31, NFR-6). Each row carries a hash of the previous
// row + its own contents, giving a tamper-evident chain.

import type { AuditAction } from "@sd/shared";
import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { sha256 } from "./crypto.js";
import { nowIso } from "./time.js";

export interface AuditDraft {
  action: AuditAction;
  entityKind?: string | null;
  entityId?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface AuditMeta {
  actorUserId: string | null;
  masqueradingAs: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** Persist one audit entry, chaining it to the most recent row. */
export async function writeAudit(
  env: Env,
  draft: AuditDraft,
  meta: AuditMeta,
): Promise<void> {
  const id = ulid();
  const createdAt = nowIso();
  const prev = await env.DB.prepare(
    "SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1",
  ).first<{ row_hash: string | null }>();
  const prevHash = prev?.row_hash ?? "";
  const detailJson = draft.detail ? JSON.stringify(draft.detail) : null;
  const rowHash = await sha256(
    [
      prevHash,
      id,
      meta.actorUserId ?? "",
      meta.masqueradingAs ?? "",
      draft.action,
      draft.entityKind ?? "",
      draft.entityId ?? "",
      detailJson ?? "",
      createdAt,
    ].join("|"),
  );

  await env.DB.prepare(
    `INSERT INTO audit_log
       (id, actor_user_id, masquerading_as, action, entity_kind, entity_id,
        detail_json, ip, user_agent, prev_hash, row_hash, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      meta.actorUserId,
      meta.masqueradingAs,
      draft.action,
      draft.entityKind ?? null,
      draft.entityId ?? null,
      detailJson,
      meta.ip,
      meta.userAgent,
      prevHash,
      rowHash,
      createdAt,
    )
    .run();
}
