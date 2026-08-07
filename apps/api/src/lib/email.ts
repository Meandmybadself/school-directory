// Email delivery via Resend. When no API key is configured (local dev), the
// message is logged to the console so the magic link is still reachable.

import type { Env } from "../env.js";

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Override the instance From header. Only the newsletter uses this, so an
   *  admin-configured sender identity doesn't change transactional mail. */
  from?: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** Send one message and report whether it was accepted.
 *
 *  `sendEmail` below keeps the never-throw, never-report contract that the auth
 *  paths depend on. This variant exists for the newsletter, which mails hundreds
 *  of recipients at once and has to record per-recipient outcomes — "we tried
 *  and Resend rejected it" and "we tried and it went through" are different
 *  facts there, and collapsing them would make a partial send unrecoverable. */
export async function sendEmailResult(env: Env, msg: SendArgs): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    // Local/dev fallback — surface the content (incl. magic link) in logs.
    console.log(
      `\n[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`,
    );
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: msg.from ?? env.EMAIL_FROM ?? `${env.SCHOOL_NAME} Directory <onboarding@resend.dev>`,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend error ${res.status}: ${body}`);
      return { ok: false, error: `${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[email] send failed: ${error}`);
    return { ok: false, error: error.slice(0, 200) };
  }
}

export async function sendEmail(env: Env, msg: SendArgs): Promise<void> {
  // Deliberately discards the result: callers on the auth path must not learn
  // delivery state, since that would reveal whether an account exists.
  await sendEmailResult(env, msg);
}

/** Member-entered values (emails, names) land in admin notifications — escape
 *  them so a hostile local-part can't inject markup into an admin's inbox. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** How a user account came into being — shown verbatim in admin notifications. */
export type JoinedVia = "signup" | "invite";

const VIA_LABEL: Record<JoinedVia, string> = {
  signup: "signed up",
  invite: "accepted an invitation",
};

export interface NewUserSummary {
  email: string;
  via: JoinedVia;
  createdAt: string;
}

function fmtWhen(iso: string): string {
  // Admin tooling is English-only; UTC keeps the cron digest unambiguous.
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Sent to system admins the moment someone joins (notifications = "instant"). */
export function newUserEmail(env: Env, u: NewUserSummary): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.APP_URL}/admin`;
  const what = VIA_LABEL[u.via];
  return {
    to: "",
    subject: `New sign-up: ${u.email}`,
    text: `${u.email} ${what} and joined the ${school} Directory.\n\n${fmtWhen(u.createdAt)}\n\nManage members: ${admin}\n\nYou're getting this because new-member notifications are on. Turn them off in Admin → Notifications.`,
    html: `<p><strong>${esc(u.email)}</strong> ${what} and joined the <strong>${esc(school)} Directory</strong>.</p>
<p style="color:#56636f;font-size:13px">${fmtWhen(u.createdAt)}</p>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because new-member notifications are on. Turn them off in Admin → Notifications.</p>`,
  };
}

/** Daily roll-up of everyone who joined since the last digest (= "daily"). */
export function newUserDigestEmail(env: Env, users: NewUserSummary[]): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.APP_URL}/admin`;
  const n = users.length;
  const heading = `${n} new ${n === 1 ? "member" : "members"} joined the ${school} Directory`;
  const lines = users.map((u) => `• ${u.email} — ${VIA_LABEL[u.via]}, ${fmtWhen(u.createdAt)}`);
  const rows = users
    .map(
      (u) =>
        `<li><strong>${esc(u.email)}</strong> <span style="color:#56636f">— ${VIA_LABEL[u.via]}, ${fmtWhen(u.createdAt)}</span></li>`,
    )
    .join("\n");
  return {
    to: "",
    subject: `${n} new ${n === 1 ? "sign-up" : "sign-ups"} — ${school} Directory`,
    text: `${heading}\n\n${lines.join("\n")}\n\nManage members: ${admin}\n\nYou're getting this because the daily new-member digest is on. Change it in Admin → Notifications.`,
    html: `<p>${esc(heading)}.</p>
<ul>${rows}</ul>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because the daily new-member digest is on. Change it in Admin → Notifications.</p>`,
  };
}

export interface NewSubscriberSummary {
  email: string;
  confirmedAt: string;
}

/** Sent to system admins when someone completes double opt-in on the public
 *  newsletter form (notifications = "instant").
 *
 *  Under the instance's own From identity, not the newsletter's configured
 *  sender — this is transactional mail to staff about the newsletter, not an
 *  issue of it, and it should look like the rest of the admin notifications in
 *  their inbox. */
export function newSubscriberEmail(env: Env, s: NewSubscriberSummary): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.NEWSLETTER_URL}/admin/subscribers`;
  return {
    to: "",
    subject: `New newsletter subscriber: ${s.email}`,
    text: `${s.email} confirmed a subscription to the ${school} Newsletter.\n\n${fmtWhen(s.confirmedAt)}\n\nManage subscribers: ${admin}\n\nYou're getting this because new-subscriber notifications are on. Change them in Newsletter → Settings → Notifications.`,
    html: `<p><strong>${esc(s.email)}</strong> confirmed a subscription to the <strong>${esc(school)} Newsletter</strong>.</p>
<p style="color:#56636f;font-size:13px">${fmtWhen(s.confirmedAt)}</p>
<p><a href="${admin}">Manage subscribers</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because new-subscriber notifications are on. Change them in Newsletter → Settings → Notifications.</p>`,
  };
}

/** Daily roll-up of everyone who confirmed since the last digest (= "daily"). */
export function newSubscriberDigestEmail(env: Env, subs: NewSubscriberSummary[]): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.NEWSLETTER_URL}/admin/subscribers`;
  const n = subs.length;
  const heading = `${n} new ${n === 1 ? "subscriber" : "subscribers"} joined the ${school} Newsletter`;
  const lines = subs.map((s) => `• ${s.email} — ${fmtWhen(s.confirmedAt)}`);
  const rows = subs
    .map(
      (s) =>
        `<li><strong>${esc(s.email)}</strong> <span style="color:#56636f">— ${fmtWhen(s.confirmedAt)}</span></li>`,
    )
    .join("\n");
  return {
    to: "",
    subject: `${n} new newsletter ${n === 1 ? "subscriber" : "subscribers"} — ${school}`,
    text: `${heading}\n\n${lines.join("\n")}\n\nManage subscribers: ${admin}\n\nYou're getting this because the daily new-subscriber digest is on. Change it in Newsletter → Settings → Notifications.`,
    html: `<p>${esc(heading)}.</p>
<ul>${rows}</ul>
<p><a href="${admin}">Manage subscribers</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because the daily new-subscriber digest is on. Change it in Newsletter → Settings → Notifications.</p>`,
  };
}

export function magicLinkEmail(env: Env, link: string): SendArgs {
  const school = env.SCHOOL_NAME;
  return {
    to: "", // filled by caller
    subject: `Sign in to the ${school} Directory`,
    text: `Sign in to the ${school} Directory.\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, you can ignore this email.`,
    html: `<p>Sign in to the <strong>${school} Directory</strong>.</p>
<p><a href="${link}">Click here to sign in</a></p>
<p style="color:#56636f;font-size:13px">This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>`,
  };
}

/** Sent to people added via bulk import: a sign-in link that, when used, binds
 *  the recipient as a controller of their imported listing (INVITE_TTL = 14 days). */
export function directoryInviteEmail(env: Env, link: string, personName: string): SendArgs {
  const school = env.SCHOOL_NAME;
  const who = personName.trim() || "you";
  return {
    to: "",
    subject: `You're listed in the ${school} Directory`,
    text: `${who} has been added to the ${school} Directory.\n\nSign in to view the directory and manage your profile:\n${link}\n\nThis link expires in 14 days. If you weren't expecting this, you can ignore this email.`,
    html: `<p><strong>${who}</strong> has been added to the <strong>${school} Directory</strong>.</p>
<p><a href="${link}">Sign in to view the directory and manage your profile</a></p>
<p style="color:#56636f;font-size:13px">This link expires in 14 days. If you weren't expecting this, you can ignore this email.</p>`,
  };
}

export function inviteEmail(
  env: Env,
  link: string,
  inviterName: string,
  personName: string,
): SendArgs {
  const school = env.SCHOOL_NAME;
  return {
    to: "",
    subject: `${inviterName} invited you to the ${school} Directory`,
    text: `${inviterName} invited you to help manage ${personName} in the ${school} Directory.\n\nAccept: ${link}\n\nThis invitation expires in 14 days.`,
    html: `<p><strong>${inviterName}</strong> invited you to help manage <strong>${personName}</strong> in the ${school} Directory.</p>
<p><a href="${link}">Accept invitation</a></p>
<p style="color:#56636f;font-size:13px">This invitation expires in 14 days.</p>`,
  };
}
