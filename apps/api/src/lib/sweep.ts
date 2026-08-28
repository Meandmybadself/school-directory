// Daily housekeeping: the tables that would otherwise only ever grow.
//
// Four tables here, and they are NOT all the same kind of problem — which is why
// they're collected in one file rather than scattered next to the features that
// write them.
//
// Two back a rate limit that COUNTS ROWS (`newsletter_confirmation` for the
// public subscribe form, `auth_token` for /auth/start). For those, retention is
// a security parameter: sweep sooner than the counting window and waiting out
// the cron becomes a way to reset the budget. Neither may key its age test on
// `expires_at` alone — a magic link dies in fifteen minutes and the count needs
// the row for a day.
//
// The other two (`session`, `control_invite`) are ordinary growth. Nothing
// counts them, so retention there is only about keeping a month of history for
// anyone looking into an incident.
//
// `audit_log` is deliberately absent and must stay absent: it is append-only and
// hash-chained (invariant 5), so deleting rows both breaks tamper-evidence and
// erases the record of what an account did.

import type { Env } from "../env.js";
import { DAYS, nowIso } from "./time.js";

/** Kept long enough to outlast any counting window, short enough to bound the
 *  table. One month also happens to be a useful amount of history to have when
 *  something needs explaining. */
const RETENTION_MS = 30 * DAYS;

function cutoff(): string {
  return new Date(Date.now() - RETENTION_MS).toISOString();
}

/** Run one DELETE, log what it removed, and never throw — a failing sweep must
 *  not take the rest of the cron down with it. */
async function sweep(env: Env, what: string, sql: string, binds: unknown[]): Promise<void> {
  try {
    const res = await env.DB.prepare(sql).bind(...binds).run();
    const n = res.meta?.changes ?? 0;
    if (n > 0) console.log(`[sweep] removed ${n} ${what}`);
  } catch (err) {
    console.error(`[sweep] ${what} failed: ${String(err)}`);
  }
}

/**
 * Spent magic-link and invite tokens.
 *
 * Backs the /auth/start rate limit, so see the retention note at the top of this
 * file before shortening RETENTION_MS. A row goes only once it is ALSO finished
 * with — consumed, or past its expiry — so an unclaimed 14-day invite is never
 * swept out from under its recipient by the age test alone.
 */
export async function sweepSpentAuthTokens(env: Env): Promise<void> {
  await sweep(
    env,
    "spent auth token(s)",
    `DELETE FROM auth_token
      WHERE created_at < ?
        AND (consumed_at IS NOT NULL OR expires_at < ?)`,
    [cutoff(), nowIso()],
  );
}

/**
 * Spent newsletter confirmations.
 *
 * Backs the public subscribe form's daily cap the same way. Unlike the original
 * version of this sweep, the age test is on `created_at` rather than
 * `expires_at`: those tokens live long enough that it rarely mattered, but
 * keying on expiry is the mistake that would quietly defeat the cap, and the two
 * sweeps should not differ on the point.
 */
export async function sweepExpiredConfirmations(env: Env): Promise<void> {
  await sweep(
    env,
    "spent newsletter confirmation(s)",
    `DELETE FROM newsletter_confirmation
      WHERE created_at < ?
        AND (consumed_at IS NOT NULL OR expires_at < ?)`,
    [cutoff(), nowIso()],
  );
}

/**
 * Dead sessions.
 *
 * Only rows that are already refused at the door — revoked, or past expiry — so
 * this can never sign anybody out. A masquerade's PARENT session is neither, so
 * it survives here; and `/admin/masquerade/stop` already mints a fresh session
 * when the parent has gone, so even that case degrades to a re-login rather than
 * a lockout.
 */
export async function sweepDeadSessions(env: Env): Promise<void> {
  await sweep(
    env,
    "dead session(s)",
    `DELETE FROM session
      WHERE created_at < ?
        AND (revoked_at IS NOT NULL OR expires_at < ?)`,
    [cutoff(), nowIso()],
  );
}

/**
 * Settled control invitations.
 *
 * Accepted, cancelled or expired only — a pending invite inside its window is
 * left alone however old it is, because that is somebody still waiting to be
 * given control of their own listing. Nothing is lost by removing the rest:
 * `audit_log` records the acceptance (`invite.accepted`, `control.granted`) and
 * the `control` row is the standing fact.
 */
export async function sweepSettledInvites(env: Env): Promise<void> {
  await sweep(
    env,
    "settled control invite(s)",
    `DELETE FROM control_invite
      WHERE created_at < ?
        AND (status != 'pending' OR expires_at < ?)`,
    [cutoff(), nowIso()],
  );
}

/** Everything above, from the daily cron. Each is independently guarded, so one
 *  failing table doesn't stop the others. */
export async function runDailySweeps(env: Env): Promise<void> {
  await sweepSpentAuthTokens(env);
  await sweepExpiredConfirmations(env);
  await sweepDeadSessions(env);
  await sweepSettledInvites(env);
}
