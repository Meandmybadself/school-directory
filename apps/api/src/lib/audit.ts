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

/** Hash of one row's contents, bound to its predecessor. The field order is the
 *  chain's format: changing it invalidates every existing row, so don't. */
async function chainHash(
  prevHash: string,
  id: string,
  meta: AuditMeta,
  draft: AuditDraft,
  detailJson: string | null,
  createdAt: string,
): Promise<string> {
  return sha256(
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
}

/**
 * How many times a writer will re-read the tail after losing the race for a
 * position.
 *
 * Sized against the failure it prevents, not against a typical request. Each
 * retry means another concurrent append won, so with N writers arriving
 * together the unluckiest needs about N attempts — and exhausting the budget
 * DROPS an audit entry, which is a worse outcome than the fork this replaced.
 * 25 leaves a wide margin over any burst one school's API will produce, and the
 * jitter below keeps contenders from re-colliding in lockstep on every round.
 */
const APPEND_ATTEMPTS = 25;

/** Backoff after losing a position. Randomised because the alternative is a
 *  herd that re-reads and re-collides in step; the wait is free either way,
 *  since audit writes are flushed inside `waitUntil`, off the response path. */
function backoff(attempt: number): Promise<void> {
  const ms = Math.min(2 ** attempt, 16) * (1 + Math.random());
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persist one audit entry, chained to the row before it.
 *
 * The append is a compare-and-swap, not a read-then-write. Reading the tail and
 * inserting a successor are two statements with no transaction between them
 * (D1 has none), and this runs inside `waitUntil`, so concurrent requests
 * genuinely do interleave here: both would read row N and both would write a
 * successor claiming N as its parent, forking the chain into a tree.
 *
 * So the writer claims a POSITION. `seq` is unique (migration 0016), and the
 * insert is `ON CONFLICT DO NOTHING` — the loser changes zero rows, sees that,
 * re-reads the new tail and chains onto the winner instead. Same idiom as the
 * volunteer overfill guard and the last-admin guard: the guard lives inside the
 * statement, and `meta.changes` is the answer.
 */
export async function writeAudit(
  env: Env,
  draft: AuditDraft,
  meta: AuditMeta,
): Promise<void> {
  const detailJson = draft.detail ? JSON.stringify(draft.detail) : null;

  for (let attempt = 0; attempt < APPEND_ATTEMPTS; attempt++) {
    const prev = await env.DB.prepare(
      "SELECT seq, row_hash FROM audit_log ORDER BY seq DESC LIMIT 1",
    ).first<{ seq: number | null; row_hash: string | null }>();
    const prevHash = prev?.row_hash ?? "";
    const seq = (prev?.seq ?? 0) + 1;

    // Minted per attempt: a losing insert wrote nothing, so reusing the id would
    // be fine — but a fresh one keeps "id" meaning "the row that exists".
    const id = ulid();
    const createdAt = nowIso();
    const rowHash = await chainHash(prevHash, id, meta, draft, detailJson, createdAt);

    const res = await env.DB.prepare(
      `INSERT INTO audit_log
         (id, seq, actor_user_id, masquerading_as, action, entity_kind, entity_id,
          detail_json, ip, user_agent, prev_hash, row_hash, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (seq) DO NOTHING`,
    )
      .bind(
        id,
        seq,
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

    if (res.meta.changes) return;
    await backoff(attempt);
  }

  // Losing this many rounds isn't contention any more, it's something wrong with
  // the index. Loud, because a dropped audit entry is the failure this whole
  // file exists to prevent.
  console.error(`[audit] gave up appending ${draft.action} after ${APPEND_ATTEMPTS} attempts`);
}

/** One broken link in the chain: the row whose stored hash doesn't match. */
export interface AuditChainBreak {
  seq: number;
  id: string;
  createdAt: string;
  /** "hash" — the row's contents don't hash to its stored row_hash.
   *  "link"  — its prev_hash doesn't match the previous row's row_hash.
   *  "gap"   — the sequence skips, so a row was deleted. */
  kind: "hash" | "link" | "gap";
}

export interface AuditChainResult {
  ok: boolean;
  checked: number;
  breaks: AuditChainBreak[];
}

/**
 * Walk the chain and re-derive every row's hash.
 *
 * Without this, `prev_hash` and `row_hash` were written and never read — the
 * tamper evidence invariant 5 promises was stored but never asserted, which is
 * also why the forking above went unnoticed for so long. A hash nobody checks
 * is not evidence.
 *
 * Note for anyone running this against a log that predates migration 0016:
 * rows appended by the old racy writer may legitimately show `link` breaks.
 * That is the old defect being visible, not a new one.
 */
export async function verifyAuditChain(
  env: Env,
  opts: { limit?: number } = {},
): Promise<AuditChainResult> {
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 50_000);
  const rows = await env.DB.prepare(
    `SELECT id, seq, actor_user_id, masquerading_as, action, entity_kind, entity_id,
            detail_json, prev_hash, row_hash, created_at
       FROM audit_log ORDER BY seq ASC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: string;
      seq: number | null;
      actor_user_id: string | null;
      masquerading_as: string | null;
      action: string;
      entity_kind: string | null;
      entity_id: string | null;
      detail_json: string | null;
      prev_hash: string | null;
      row_hash: string | null;
      created_at: string;
    }>();

  const breaks: AuditChainBreak[] = [];
  let expectedPrev = "";
  let expectedSeq: number | null = null;

  for (const r of rows.results) {
    const seq = r.seq ?? 0;
    const at = { seq, id: r.id, createdAt: r.created_at };

    if (expectedSeq !== null && seq !== expectedSeq) {
      breaks.push({ ...at, kind: "gap" });
    }
    expectedSeq = seq + 1;

    if ((r.prev_hash ?? "") !== expectedPrev) {
      breaks.push({ ...at, kind: "link" });
    }

    const recomputed = await chainHash(
      r.prev_hash ?? "",
      r.id,
      { actorUserId: r.actor_user_id, masqueradingAs: r.masquerading_as, ip: null, userAgent: null },
      {
        action: r.action as AuditDraft["action"],
        entityKind: r.entity_kind,
        entityId: r.entity_id,
      },
      r.detail_json,
      r.created_at,
    );
    if (recomputed !== (r.row_hash ?? "")) {
      breaks.push({ ...at, kind: "hash" });
    }

    // Continue from what's STORED, not what we recomputed, so one altered row
    // reports as one break rather than cascading into every row after it.
    expectedPrev = r.row_hash ?? "";
  }

  return { ok: breaks.length === 0, checked: rows.results.length, breaks };
}
