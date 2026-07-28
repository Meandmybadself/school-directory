// New-member notifications for system admins. Two delivery modes, one setting:
//
//   off      — nothing is sent (default; an admin must opt in)
//   instant  — one email per join, fired from the auth callback via waitUntil
//   daily    — a single digest, fired from the daily cron in index.ts
//
// Accounts created from the admin console never notify — the admin who made one
// already knows. Recipients are every system admin plus the configured bootstrap
// admins (who may not have a user row yet on a fresh instance).

import type { NewUserNotify } from "@sd/shared";
import type { Env } from "../env.js";
import { bootstrapAdminEmails, getSetting, setSetting } from "./db.js";
import {
  newUserDigestEmail,
  newUserEmail,
  sendEmail,
  type JoinedVia,
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
