// Email delivery via Resend. When no API key is configured (local dev), the
// message is logged to the console so the magic link is still reachable.

import type { Env } from "../env.js";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, msg: SendArgs): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Local/dev fallback — surface the content (incl. magic link) in logs.
    console.log(
      `\n[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`,
    );
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? `${env.SCHOOL_NAME} Directory <onboarding@resend.dev>`,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend error ${res.status}: ${body}`);
    // Do not throw to the caller in a way that reveals delivery state to the client.
  }
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
    text: `${u.email} ${what} and joined the ${school} School Directory.\n\n${fmtWhen(u.createdAt)}\n\nManage members: ${admin}\n\nYou're getting this because new-member notifications are on. Turn them off in Admin → Notifications.`,
    html: `<p><strong>${esc(u.email)}</strong> ${what} and joined the <strong>${esc(school)} School Directory</strong>.</p>
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
  const heading = `${n} new ${n === 1 ? "member" : "members"} joined the ${school} School Directory`;
  const lines = users.map((u) => `• ${u.email} — ${VIA_LABEL[u.via]}, ${fmtWhen(u.createdAt)}`);
  const rows = users
    .map(
      (u) =>
        `<li><strong>${esc(u.email)}</strong> <span style="color:#56636f">— ${VIA_LABEL[u.via]}, ${fmtWhen(u.createdAt)}</span></li>`,
    )
    .join("\n");
  return {
    to: "",
    subject: `${n} new ${n === 1 ? "sign-up" : "sign-ups"} — ${school} School Directory`,
    text: `${heading}\n\n${lines.join("\n")}\n\nManage members: ${admin}\n\nYou're getting this because the daily new-member digest is on. Change it in Admin → Notifications.`,
    html: `<p>${esc(heading)}.</p>
<ul>${rows}</ul>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because the daily new-member digest is on. Change it in Admin → Notifications.</p>`,
  };
}

export function magicLinkEmail(env: Env, link: string): SendArgs {
  const school = env.SCHOOL_NAME;
  return {
    to: "", // filled by caller
    subject: `Sign in to the ${school} School Directory`,
    text: `Sign in to the ${school} School Directory.\n\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, you can ignore this email.`,
    html: `<p>Sign in to the <strong>${school} School Directory</strong>.</p>
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
    subject: `You're listed in the ${school} School Directory`,
    text: `${who} has been added to the ${school} School Directory.\n\nSign in to view the directory and manage your profile:\n${link}\n\nThis link expires in 14 days. If you weren't expecting this, you can ignore this email.`,
    html: `<p><strong>${who}</strong> has been added to the <strong>${school} School Directory</strong>.</p>
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
    subject: `${inviterName} invited you to the ${school} School Directory`,
    text: `${inviterName} invited you to help manage ${personName} in the ${school} School Directory.\n\nAccept: ${link}\n\nThis invitation expires in 14 days.`,
    html: `<p><strong>${inviterName}</strong> invited you to help manage <strong>${personName}</strong> in the ${school} School Directory.</p>
<p><a href="${link}">Accept invitation</a></p>
<p style="color:#56636f;font-size:13px">This invitation expires in 14 days.</p>`,
  };
}
