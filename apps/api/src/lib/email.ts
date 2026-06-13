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
