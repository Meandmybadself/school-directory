// Admin notifications. Two subjects — new MEMBERS and new newsletter
// SUBSCRIBERS — sharing three modes:
//
//   off      — nothing is sent (default; an admin must opt in)
//   instant  — one email per event, fired at the source via waitUntil
//   daily    — a single digest, fired from the daily cron in index.ts
//
// One rule governs both: a thing an admin did themselves never notifies. An
// account created from the admin console doesn't, and neither does an address
// added on the subscribers screen or by bulk import — only a stranger
// completing the public double opt-in does.
//
// The two are chosen by different people, which is deliberate rather than
// sloppy. The MEMBER mode is each admin's own (`user.new_user_notify`,
// migration 0026, behind /settings/notifications on the directory's Admin
// screen): one admin wanting every sign-up in their inbox is no reason to put
// it in everyone else's. The SUBSCRIBER mode is still one instance-wide field
// on the newsletter settings blob, edited on the newsletter's own Settings
// screen, and goes to every system admin plus the configured bootstrap admins
// (who may not have a user row yet on a fresh instance). Only the digest
// CURSORS are alike, and both live here.

import type { NewUserNotify } from "@sd/shared";
import type { Env } from "../env.js";
import { bootstrapAdminEmails, getSetting, setSetting } from "./db.js";
import { getNewsletterSettings } from "./newsletter.js";
import {
  accessRequestEmail,
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

const DIGEST_CURSOR_KEY = "new_user_digest_since";

/** Joins that count as "someone new showed up" — admin-provisioned is excluded. */
const NOTIFIABLE: JoinedVia[] = ["signup", "invite"];

function asMode(v: unknown): NewUserNotify {
  return v === "instant" || v === "daily" ? v : "off";
}

/** One admin's own new-member mode. */
export async function getNewUserNotify(env: Env, userId: string): Promise<NewUserNotify> {
  const row = await env.DB.prepare("SELECT new_user_notify FROM user WHERE id = ?")
    .bind(userId)
    .first<{ new_user_notify: string | null }>();
  return asMode(row?.new_user_notify);
}

/** Set one admin's own new-member mode. There is no per-admin digest cursor:
 *  the shared one advances on every daily run, so switching to the digest
 *  replays at most the day already under way. */
export async function setNewUserNotify(env: Env, userId: string, mode: NewUserNotify): Promise<void> {
  await env.DB.prepare("UPDATE user SET new_user_notify = ? WHERE id = ?").bind(mode, userId).run();
}

/** The admins who asked for new-member mail in `mode`. Enabled system admins
 *  only — the column survives a demotion or a disable, and must not keep
 *  mailing someone who is no longer an admin. Bootstrap addresses without a
 *  row are not included: with no row there is no choice to read, and the
 *  default is off. */
async function newUserRecipients(env: Env, mode: "instant" | "daily", exclude?: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT email FROM user
      WHERE is_system_admin = 1 AND disabled_at IS NULL AND new_user_notify = ?`,
  )
    .bind(mode)
    .all<{ email: string }>();
  const all = new Set(rows.results.map((r) => r.email.toLowerCase()));
  if (exclude) all.delete(exclude.toLowerCase());
  return [...all];
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

/** Called when a user row is first created. Mails the admins who chose "instant". */
export async function notifyNewUser(env: Env, user: NewUserSummary): Promise<void> {
  try {
    if (!NOTIFIABLE.includes(user.via)) return;
    // Don't notify the new member about themselves (bootstrap-admin first run).
    const recipients = await newUserRecipients(env, "instant", user.email);
    if (recipients.length === 0) return;
    await fanOut(env, recipients, newUserEmail(env, user));
  } catch (err) {
    console.error(`[notify] new-user notification failed: ${String(err)}`);
  }
}

/**
 * Somebody asked to read the directory (migration 0029).
 *
 * Unlike the new-member notification above, this is NOT opt-in per admin and
 * has no digest mode: a pending application is a queue item, and a family
 * waiting on one cannot do anything about an admin who turned mail off. It
 * goes to every system admin plus the bootstrap addresses, which is the same
 * set `adminRecipients` already resolves for the things that need doing.
 *
 * The message carries the applicant's ADDRESS and nothing else about them —
 * not the child's name, not the room. Those are the reviewer's to read behind a
 * session, on a screen this email links to; putting them in mail would copy a
 * family's claim into every admin's inbox to save one click.
 */
export async function notifyAccessRequest(env: Env, req: { email: string }): Promise<void> {
  try {
    const recipients = await adminRecipients(env, req.email);
    if (recipients.length === 0) return;
    await fanOut(env, recipients, accessRequestEmail(env, req));
  } catch (err) {
    console.error(`[notify] access-request notification failed: ${String(err)}`);
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

/** Reset the digest window. Called when the setting changes INTO "daily", so
 *  turning it on doesn't replay everyone who subscribed while it was off —
 *  the member digest needs no such reset because its cursor advances daily. */
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

/** Daily cron entry point. Mails the admins who chose "daily". Advances the
 *  cursor on EVERY run — even when nobody joined and nobody is subscribed — so
 *  the window is always "since yesterday's run", and an admin switching to the
 *  digest today is never sent a backlog. */
export async function sendNewUserDigest(env: Env): Promise<void> {
  try {
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

    const recipients = await newUserRecipients(env, "daily");
    if (recipients.length === 0) return;

    const users: NewUserSummary[] = rows.results.map((r) => ({
      email: r.email,
      via: r.joined_via === "invite" ? "invite" : "signup",
      createdAt: r.created_at,
    }));
    await fanOut(env, recipients, newUserDigestEmail(env, users));
  } catch (err) {
    console.error(`[notify] digest failed: ${String(err)}`);
  }
}
