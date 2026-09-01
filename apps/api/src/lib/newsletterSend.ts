// Sending an issue: the state machine and the fan-out.
//
// Two properties this has to have, and how each is obtained:
//
//   Idempotency. A double-clicked Send must not mail everyone twice. The
//   transition into 'sending' is a compare-and-swap —
//   `UPDATE ... SET status='sending' WHERE id=? AND status='draft'` — and the
//   loser of the race sees `changes === 0` and is turned away. D1 is a single
//   writer per database, so this needs no external lock. Crucially the CAS runs
//   BEFORE the slow work (audience + event resolution), which is the only
//   ordering that actually closes the race.
//
//   Resumability. Every recipient gets a 'pending' newsletter_send row before
//   any mail is attempted. A fan-out cut short — a recycled Worker, a Resend
//   outage — therefore leaves a state that can be read and resumed rather than
//   one nobody can interpret. Retry is just "process everything not yet 'sent'",
//   which covers both a genuine per-address failure and a truncated run with one
//   code path.

import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { nowIso } from "./time.js";
import { randomToken } from "./crypto.js";
import { sendEmailResult } from "./email.js";
import {
  getNewsletterSettings,
  issueEmailArgs,
  resolveAudience,
  resolveEventsSnapshot,
} from "./newsletter.js";
import type { NewsletterNode } from "@sd/shared";

/** Parallel sends in flight. Matches sendBulkInvites in routes/admin.ts — enough
 *  to finish a school-sized list quickly without hammering Resend. */
const CONCURRENCY = 5;

/** Recipient rows inserted per D1 batch. */
const INSERT_CHUNK = 100;

export interface IssueRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  subject: string;
  content_json: string;
  events_snapshot_json: string | null;
  status: string;
  recipient_total: number;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** SHA-256 of the review link's token, or null when none is live. Never
   *  leaves the server — `detailOf` reports only whether it is set. Deliberately
   *  survives a send: the link is revocable with no expiry, so one already
   *  circulated keeps working and starts showing the sent issue. */
  preview_token_hash: string | null;
  preview_token_created_at: string | null;
  /** Start of the editing session the last `newsletter.issue.updated` audit row
   *  stands for (migration 0020). Audit bookkeeping, not issue state: only
   *  `claimEditSession` in routes/newsletter.ts reads or moves it, and it
   *  reaches no DTO. */
  audit_session_at: string | null;
}

export type StartSendOutcome =
  | { ok: true; recipientTotal: number }
  | { ok: false; reason: "not_found" | "not_draft" | "no_recipients" };

/** Claim the issue and stage the send. Fast enough to run inside the request:
 *  a handful of D1 reads plus one batched insert. The actual mailing happens in
 *  `runFanOut`, which the caller hands to waitUntil. */
export async function startSend(env: Env, issueId: string): Promise<StartSendOutcome> {
  const claim = await env.DB.prepare(
    "UPDATE newsletter_issue SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'draft'",
  )
    .bind(nowIso(), issueId)
    .run();

  if (claim.meta.changes === 0) {
    const exists = await env.DB.prepare("SELECT id FROM newsletter_issue WHERE id = ?")
      .bind(issueId)
      .first<{ id: string }>();
    return { ok: false, reason: exists ? "not_draft" : "not_found" };
  }

  try {
    const issue = await env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
      .bind(issueId)
      .first<IssueRow>();
    if (!issue) return { ok: false, reason: "not_found" };

    const doc = JSON.parse(issue.content_json) as NewsletterNode;
    const startedAt = nowIso();

    // Freeze the events blocks against this instant. From here the archive page
    // and the email are reading the same list forever.
    const snapshot = await resolveEventsSnapshot(env, doc, startedAt);
    const audience = await resolveAudience(env);

    if (audience.length === 0) {
      // Nothing to send. Release the claim so the draft stays editable rather
      // than stranding it in 'sending' with no rows to drive it forward.
      await env.DB.prepare(
        "UPDATE newsletter_issue SET status = 'draft', updated_at = ? WHERE id = ?",
      )
        .bind(nowIso(), issueId)
        .run();
      return { ok: false, reason: "no_recipients" };
    }

    const inserts = audience.map((m) =>
      env.DB.prepare(
        `INSERT INTO newsletter_send
           (id, issue_id, email, user_id, subscriber_id, unsubscribe_token, status, created_at)
         VALUES (?,?,?,?,?,?, 'pending', ?)
         ON CONFLICT (issue_id, email) DO NOTHING`,
      ).bind(ulid(), issueId, m.email, m.userId, m.subscriberId, randomToken(), startedAt),
    );
    for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
      await env.DB.batch(inserts.slice(i, i + INSERT_CHUNK));
    }

    await env.DB.prepare(
      `UPDATE newsletter_issue
          SET events_snapshot_json = ?, recipient_total = ?, sent_at = ?, updated_at = ?
        WHERE id = ?`,
    )
      .bind(JSON.stringify(snapshot), audience.length, startedAt, startedAt, issueId)
      .run();

    return { ok: true, recipientTotal: audience.length };
  } catch (err) {
    // Staging blew up after the claim. Hand the issue back rather than leaving
    // it permanently 'sending' and un-editable.
    console.error(`[newsletter] staging failed for ${issueId}: ${String(err)}`);
    await env.DB.prepare(
      "UPDATE newsletter_issue SET status = 'draft', updated_at = ? WHERE id = ?",
    )
      .bind(nowIso(), issueId)
      .run()
      .catch(() => {});
    throw err;
  }
}

interface PendingRow {
  id: string;
  email: string;
  unsubscribe_token: string;
}

/** Write one recipient's outcome to the ledger, retrying once.
 *
 *  Worth the retry because of what losing this write costs: the email HAS been
 *  delivered, but the row still reads 'pending'/'failed', so the next
 *  "retry failed" mails that person a second copy. The send itself can't be
 *  taken back, so the ledger is the only thing standing between a transient D1
 *  blip and a duplicate newsletter. */
async function recordOutcome(
  env: Env,
  sendId: string,
  result: { ok: boolean; error?: string },
): Promise<void> {
  const write = () =>
    env.DB.prepare("UPDATE newsletter_send SET status = ?, error = ?, sent_at = ? WHERE id = ?")
      .bind(
        result.ok ? "sent" : "failed",
        result.ok ? null : (result.error ?? "unknown"),
        result.ok ? nowIso() : null,
        sendId,
      )
      .run();
  try {
    await write();
  } catch (first) {
    try {
      await write();
    } catch (second) {
      // Both attempts lost. Logged loudly because the consequence is a possible
      // duplicate on the next retry, not a silent no-op.
      console.error(
        `[newsletter] ledger write lost for ${sendId} (delivered=${result.ok}): ${String(first)} / ${String(second)}`,
      );
    }
  }
}

/** Mail everyone not yet marked 'sent', then close the issue out. Never throws
 *  — it runs detached in waitUntil, where a rejection would just be logged by
 *  the runtime and lose the per-recipient detail this records instead. */
export async function runFanOut(env: Env, issueId: string): Promise<void> {
  try {
    const issue = await env.DB.prepare("SELECT * FROM newsletter_issue WHERE id = ?")
      .bind(issueId)
      .first<IssueRow>();
    if (!issue) return;

    const settings = await getNewsletterSettings(env);
    const content = JSON.parse(issue.content_json) as NewsletterNode;
    const snapshot = issue.events_snapshot_json
      ? (JSON.parse(issue.events_snapshot_json) as Record<string, never>)
      : {};

    const pending = await env.DB.prepare(
      "SELECT id, email, unsubscribe_token FROM newsletter_send WHERE issue_id = ? AND status != 'sent'",
    )
      .bind(issueId)
      .all<PendingRow>();

    for (let i = 0; i < pending.results.length; i += CONCURRENCY) {
      const chunk = pending.results.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (row) => {
          // Built per recipient because the unsubscribe link is per recipient —
          // a shared link would let one reader unsubscribe another.
          const msg = issueEmailArgs({
            env,
            settings,
            issue: {
              slug: issue.slug,
              title: issue.title,
              subtitle: issue.subtitle,
              subject: issue.subject,
              content,
            },
            snapshot,
            unsubscribeToken: row.unsubscribe_token,
          });
          const result = await sendEmailResult(env, { ...msg, to: row.email });
          await recordOutcome(env, row.id, result);
        }),
      );

      // Heartbeat, so a legitimately long run isn't mistaken for an abandoned
      // one by retryFailed's staleness check below.
      await env.DB.prepare("UPDATE newsletter_issue SET updated_at = ? WHERE id = ?")
        .bind(nowIso(), issueId)
        .run()
        .catch(() => {});
    }

    // 'sent' means the run completed, not that every address succeeded — the
    // per-recipient failures stay visible in the ledger and are retryable.
    await env.DB.prepare(
      "UPDATE newsletter_issue SET status = 'sent', updated_at = ? WHERE id = ?",
    )
      .bind(nowIso(), issueId)
      .run();
  } catch (err) {
    console.error(`[newsletter] fan-out failed for ${issueId}: ${String(err)}`);
  }
}

/** How long an issue may sit in 'sending' before a retry assumes the run that
 *  claimed it is gone. Comfortably longer than any real fan-out, short enough
 *  that a stuck issue is recoverable the same day. */
const STALE_SENDING_MS = 15 * 60 * 1000;

/** Re-run delivery for anything that didn't land. Safe to call repeatedly.
 *
 *  Retries from 'sent' (the ordinary case — some addresses bounced) AND from a
 *  STALE 'sending'. The second case is the one that matters: `runFanOut` runs
 *  detached in waitUntil, so if the Worker is evicted partway through a large
 *  audience, nothing ever flips the issue to 'sent'. Without this it would be
 *  stranded in 'sending' forever — un-editable, un-deletable and un-retryable,
 *  with its remaining recipients never mailed. The staleness window is what
 *  keeps a retry from racing a fan-out that is still legitimately running. */
export async function retryFailed(env: Env, issueId: string): Promise<boolean> {
  const outstanding = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM newsletter_send WHERE issue_id = ? AND status != 'sent'",
  )
    .bind(issueId)
    .first<{ n: number }>();
  if (!outstanding || outstanding.n === 0) return false;

  const now = nowIso();
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE newsletter_issue SET status = 'sending', updated_at = ?
      WHERE id = ?
        AND (status = 'sent' OR (status = 'sending' AND updated_at < ?))`,
  )
    .bind(now, issueId, staleBefore)
    .run();
  return claim.meta.changes > 0;
}

export interface RecipientCounts {
  pending: number;
  sent: number;
  failed: number;
}

export async function recipientCounts(env: Env, issueId: string): Promise<RecipientCounts> {
  const rows = await env.DB.prepare(
    "SELECT status, COUNT(*) AS n FROM newsletter_send WHERE issue_id = ? GROUP BY status",
  )
    .bind(issueId)
    .all<{ status: string; n: number }>();
  const counts: RecipientCounts = { pending: 0, sent: 0, failed: 0 };
  for (const r of rows.results) {
    if (r.status === "pending" || r.status === "sent" || r.status === "failed") {
      counts[r.status] = r.n;
    }
  }
  return counts;
}
