// Admin notifications. Two subjects — new MEMBERS and new newsletter
// SUBSCRIBERS — each with its own independent setting, sharing three modes:
//
//   off      — nothing is sent (default; an admin must opt in)
//   instant  — one email per event, fired at the source via waitUntil
//   daily    — a single digest, fired from the daily cron in index.ts
//
// One rule governs both: a thing an admin did themselves never notifies. An
// account created from the admin console doesn't, and neither does an address
// added on the subscribers screen or by bulk import — only a stranger
// completing the public double opt-in does. Recipients are every system admin
// plus the configured bootstrap admins (who may not have a user row yet on a
// fresh instance).
//
// The two settings live in different places, which is deliberate rather than
// sloppy: the member setting is its own `setting` row behind /settings/
// notifications (the directory's Admin screen), while the subscriber setting is
// a field on the newsletter settings blob, edited on the newsletter's own
// Settings screen — each app owns its own admin. Only the digest CURSORS are
// alike, and both live here.

import type { NewUserNotify } from "@sd/shared";
import type { Env } from "../env.js";
import { bootstrapAdminEmails, getSetting, setSetting } from "./db.js";
import { getNewsletterSettings } from "./newsletter.js";
import {
  newSubscriberDigestEmail,
  newSubscriberEmail,
  newUserDigestEmail,
  newUserEmail,
  sendEmail,
  type JoinedVia,
  type NewSubscriberSummary,
  type NewUserSummary,
} from "./email.js";
import { DAYS, nowIso } from "./time.js";

const MODE_KEY = "new_user_notify";
const DIGEST_CURSOR_KEY = "new_user_digest_since";

/** Joins that count as "someone new showed up" — admin-provisioned is excluded. */
const NOTIFIABLE: JoinedVia[] = ["signup", "invite"];

export async function getNewUserNotify(env: Env): Promise<NewUserNotify> {
  const v = await getSetting(env, MODE_KEY);
  return v === "instant" || v === "daily" ? v : "off";
}

export async function setNewUserNotify(env: Env, mode: NewUserNotify): Promise<void> {
  await setSetting(env, MODE_KEY, mode);
  // Switching into digest mode starts the window here, so turning it on doesn't
  // replay every member who joined while it was off.
  if (mode === "daily") await setSetting(env, DIGEST_CURSOR_KEY, nowIso());
}

/** Every address that should receive admin notifications, minus `exclude`. */
async function adminRecipients(env: Env, exclude?: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT email FROM user WHERE is_system_admin = 1",
  ).all<{ email: string }>();
  const all = new Set<string>(bootstrapAdminEmails(env));
  for (const r of rows.results) all.add(r.email.toLowerCase());
  if (exclude) all.delete(exclude.toLowerCase());
  return [...all];
}

/** Fan one message out to the admins. Never throws — callers are in waitUntil. */
async function fanOut(
  env: Env,
  recipients: string[],
  msg: { subject: string; html: string; text: string },
): Promise<void> {
  for (const to of recipients) {
    try {
      await sendEmail(env, { ...msg, to });
    } catch (err) {
      console.error(`[notify] send failed to=${to}: ${String(err)}`);
    }
  }
}

/** Called when a user row is first created. No-op unless mode is "instant". */
export async function notifyNewUser(env: Env, user: NewUserSummary): Promise<void> {
  try {
    if (!NOTIFIABLE.includes(user.via)) return;
    if ((await getNewUserNotify(env)) !== "instant") return;
    // Don't notify the new member about themselves (bootstrap-admin first run).
    const recipients = await adminRecipients(env, user.email);
    if (recipients.length === 0) return;
    await fanOut(env, recipients, newUserEmail(env, user));
  } catch (err) {
    console.error(`[notify] new-user notification failed: ${String(err)}`);
  }
}

// ── New newsletter subscribers ──────────────────────────────────────────────

const SUBSCRIBER_DIGEST_CURSOR_KEY = "new_subscriber_digest_since";

/** Called after a public double opt-in completes. No-op unless mode is
 *  "instant". Never throws — the caller is in waitUntil, and a failed
 *  notification must not affect whether the subscription itself stuck. */
export async function notifyNewSubscriber(env: Env, sub: NewSubscriberSummary): Promise<void> {
  try {
    const settings = await getNewsletterSettings(env);
    if (settings.newSubscriberNotify !== "instant") return;
    // Exclude the subscriber themselves: an admin who signs up through the
    // public form shouldn't be told about it.
    const recipients = await adminRecipients(env, sub.email);
    if (recipients.length === 0) return;
    await fanOut(env, recipients, newSubscriberEmail(env, sub));
  } catch (err) {
    console.error(`[notify] new-subscriber notification failed: ${String(err)}`);
  }
}

/** Delete confirmations nothing can use any more.
 *
 *  `newsletter_confirmation` is written by an anonymous public route, and
 *  nothing reads a row past `expires_at` or after it is consumed — so without a
 *  sweep the table only grows, at a rate set by whoever is hitting the form.
 *  Runs on the daily cron next to the digests. Consumed rows are kept for a
 *  grace period rather than deleted at once, so a reader who clicks the same
 *  link twice still gets "already used" rather than a bare 404 while the page
 *  is likely still open. */
export async function sweepExpiredConfirmations(env: Env): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DAYS).toISOString();
    const res = await env.DB.prepare(
      `DELETE FROM newsletter_confirmation
        WHERE expires_at < ?
           OR (consumed_at IS NOT NULL AND consumed_at < ?)`,
    )
      .bind(nowIso(), cutoff)
      .run();
    const n = res.meta?.changes ?? 0;
    if (n > 0) console.log(`[notify] swept ${n} spent newsletter confirmation(s)`);
  } catch (err) {
    console.error(`[notify] confirmation sweep failed: ${String(err)}`);
  }
}

/** Reset the digest window. Called when the setting changes INTO "daily", so
 *  turning it on doesn't replay everyone who subscribed while it was off —
 *  the same thing setNewUserNotify does for members. */
export async function startSubscriberDigestWindow(env: Env): Promise<void> {
  await setSetting(env, SUBSCRIBER_DIGEST_CURSOR_KEY, nowIso());
}

/** Daily cron entry point. No-op unless mode is "daily". Advances the cursor
 *  even when nobody subscribed, so the window never grows unbounded. */
export async function sendNewSubscriberDigest(env: Env): Promise<void> {
  try {
    const settings = await getNewsletterSettings(env);
    if (settings.newSubscriberNotify !== "daily") return;

    const now = nowIso();
    const since =
      (await getSetting(env, SUBSCRIBER_DIGEST_CURSOR_KEY)) ??
      new Date(Date.now() - DAYS).toISOString();

    // confirmed_at, not created_at: only the public double opt-in sets it, so
    // admin-added and bulk-imported addresses are excluded by construction
    // rather than by a filter someone could forget. See migration 0014.
    const rows = await env.DB.prepare(
      `SELECT email, confirmed_at
         FROM newsletter_subscriber
        WHERE confirmed_at > ? AND confirmed_at <= ?
        ORDER BY confirmed_at`,
    )
      .bind(since, now)
      .all<{ email: string; confirmed_at: string }>();

    await setSetting(env, SUBSCRIBER_DIGEST_CURSOR_KEY, now);
    if (rows.results.length === 0) return;

    const subs: NewSubscriberSummary[] = rows.results.map((r) => ({
      email: r.email,
      confirmedAt: r.confirmed_at,
    }));
    const recipients = await adminRecipients(env);
    if (recipients.length === 0) return;
    await fanOut(env, recipients, newSubscriberDigestEmail(env, subs));
  } catch (err) {
    console.error(`[notify] subscriber digest failed: ${String(err)}`);
  }
}

/** Daily cron entry point. No-op unless mode is "daily". Advances the cursor
 *  even when nobody joined, so the window never grows unbounded. */
export async function sendNewUserDigest(env: Env): Promise<void> {
  try {
    if ((await getNewUserNotify(env)) !== "daily") return;

    const now = nowIso();
    const since =
      (await getSetting(env, DIGEST_CURSOR_KEY)) ?? new Date(Date.now() - DAYS).toISOString();

    const rows = await env.DB.prepare(
      `SELECT email, joined_via, created_at
         FROM user
        WHERE created_at > ? AND created_at <= ?
          AND COALESCE(joined_via, 'signup') IN ('signup', 'invite')
        ORDER BY created_at`,
    )
      .bind(since, now)
      .all<{ email: string; joined_via: string | null; created_at: string }>();

    await setSetting(env, DIGEST_CURSOR_KEY, now);
    if (rows.results.length === 0) return;

    const users: NewUserSummary[] = rows.results.map((r) => ({
      email: r.email,
      via: r.joined_via === "invite" ? "invite" : "signup",
      createdAt: r.created_at,
    }));
    const recipients = await adminRecipients(env);
    if (recipients.length === 0) return;
    await fanOut(env, recipients, newUserDigestEmail(env, users));
  } catch (err) {
    console.error(`[notify] digest failed: ${String(err)}`);
  }
}
