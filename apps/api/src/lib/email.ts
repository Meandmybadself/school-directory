// Email delivery via Resend. When no API key is configured (local dev), the
// message is logged to the console so the magic link is still reachable.

import { escapeHtml } from "@sd/shared";
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
  /** Extra message headers. The lost & found intake's confirmation marks
   *  itself auto-generated with these, so autoresponders don't answer it. */
  headers?: Record<string, string>;
  /** Newsletter-issue mail (the fan-out and the composer's test sends). When
   *  the Cloudflare Email Sending channel is configured (`EMAIL` binding +
   *  `BULK_EMAIL_FROM`), this mail goes out through it instead of Resend — so
   *  Resend's free-plan 100/day cap belongs entirely to transactional mail
   *  (magic links, invites), whose deliverability history stays untouched. */
  bulk?: boolean;
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
/** One Resend message as the API takes it — the single place the From fallback
 *  chain and the reply_to spelling live, shared by the single and batch sends
 *  so the two can't drift. */
function resendPayload(env: Env, msg: SendArgs) {
  return {
    from: msg.from ?? env.EMAIL_FROM ?? `${env.SCHOOL_NAME} Directory <onboarding@resend.dev>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
    ...(msg.headers ? { headers: msg.headers } : {}),
  };
}

/** A Workers fetch has no default timeout, so one hung Resend call would stall
 *  a whole paced run — and the fan-out's resume logic reasons about how long a
 *  live run can go quiet, which only works if a burst is BOUNDED. Ten seconds
 *  is an eternity for this API; a send that slow is one worth failing
 *  (`isTransientSendError` classes an abort as retryable). */
const RESEND_TIMEOUT_MS = 10_000;

/** POST one body to Resend and shape the outcome the way every caller — and
 *  `isTransientSendError` — expects: "NNN: body" for a verdict, the bare
 *  message for a failure that never got one. */
async function postResend(env: Env, path: string, body: unknown): Promise<SendResult> {
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[email] Resend error ${res.status} on ${path}: ${text}`);
      return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[email] send failed on ${path}: ${error}`);
    return { ok: false, error: error.slice(0, 200) };
  }
}

/** The Cloudflare binding's error codes worth re-trying: the service's own
 *  meters and transient failures. Everything else (validation, an unverified
 *  sender, a suppressed recipient) would earn the same answer forever. */
const CF_TRANSIENT_CODES = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_DELIVERY_FAILED",
  "E_INTERNAL_SERVER_ERROR",
]);

/** Whether a failed send is worth re-trying without a human. A 429, a 5xx and
 *  a no-verdict failure (a network error, a timeout, the subrequest cap) all
 *  pass — retrying is exactly what the per-second meter and the daily quota
 *  expect. A 4xx other than 429 is Resend judging the REQUEST (a malformed
 *  address, a rejected sender): re-sending the same thing would earn the same
 *  answer forever. Cloudflare-channel errors carry their `E_*` code instead of
 *  a status and are judged by `CF_TRANSIENT_CODES`. */
export function isTransientSendError(error: string): boolean {
  if (error.startsWith("E_")) return CF_TRANSIENT_CODES.has(error.split(":")[0]!);
  const m = /^(\d{3}):/.exec(error);
  if (!m) return true;
  const status = Number(m[1]);
  return status === 429 || status >= 500;
}

/** "Name <addr>" (or a bare address) → the binding's {name, email} shape. */
function parseAddress(s: string): { name: string; email: string } {
  const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(s);
  if (m) return { name: (m[1] ?? "").trim(), email: m[2]!.trim() };
  return { name: "", email: s.trim() };
}

/** Send one message through the Cloudflare Email Sending binding.
 *
 *  The From ADDRESS must be on the onboarded sending domain, so it always
 *  comes from `BULK_EMAIL_FROM`; the display NAME keeps whatever the message
 *  asked for (the newsletter admin's configured sender), and when the asked-
 *  for address differs it survives as Reply-To — replies keep landing where
 *  they always did. Errors come back as "E_CODE: message", the shape
 *  `isTransientSendError` reads. */
async function sendViaBinding(env: Env, msg: SendArgs): Promise<SendResult> {
  const bulkFrom = parseAddress(env.BULK_EMAIL_FROM ?? "");
  const wanted = parseAddress(msg.from ?? env.EMAIL_FROM ?? "");
  const replyTo = msg.replyTo ?? (wanted.email && wanted.email !== bulkFrom.email ? wanted.email : undefined);
  try {
    await env.EMAIL!.send({
      from: { name: wanted.name || bulkFrom.name, email: bulkFrom.email },
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(replyTo ? { replyTo } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string })?.code || "E_UNKNOWN";
    const message = err instanceof Error ? err.message : String(err);
    const error = `${code}: ${message.slice(0, 160)}`;
    console.error(`[email] cloudflare send failed: ${error}`);
    return { ok: false, error };
  }
}

export async function sendEmailResult(env: Env, msg: SendArgs): Promise<SendResult> {
  // Newsletter mail takes the Cloudflare channel when it is configured; both
  // halves absent-means-off, so a deploy before the domain is onboarded (or a
  // local run) falls through to the Resend path unchanged.
  if (msg.bulk && env.EMAIL && env.BULK_EMAIL_FROM) return sendViaBinding(env, msg);
  if (!env.RESEND_API_KEY) {
    // Local/dev fallback — surface the content (incl. magic link) in logs.
    console.log(
      `\n[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`,
    );
    return { ok: true };
  }
  return postResend(env, "/emails", resendPayload(env, msg));
}

/** Pause between calls for anything that mails in bulk. Resend meters API
 *  requests PER SECOND (this account: 10/s; new accounts: 2/s), and the
 *  October 2026 newsletter send is the proof it matters: unpaced bursts of 5
 *  pushed 25 emails through in 2.3 seconds and the next 24 came back 429.
 *  One burst of at most a handful of calls per RESEND_PACE_MS stays under
 *  this account's meter with margin. */
export const RESEND_PACE_MS = 1100;

/** Resend's batch endpoint takes up to this many messages per call. */
export const BATCH_API_MAX = 100;

/** Send several messages in ONE Resend call — one subrequest, one unit against
 *  the per-second meter, however many messages ride in it (up to BATCH_API_MAX).
 *
 *  This exists for the bulk-invite path: on the Workers free plan an invocation
 *  gets 50 subrequests, so mailing a roster-sized import one fetch per address
 *  dies mid-list the way the October 2026 newsletter send did. Batched, a
 *  100-family import is a single call.
 *
 *  The trade to know before reusing it: the batch is accepted or refused as a
 *  WHOLE (Resend documents no partial-success mode), so the caller cannot learn
 *  per-recipient outcomes. That is why the newsletter does NOT use it — its
 *  ledger records a verdict per recipient — and why callers here keep batches
 *  small and fall back to single sends when a batch is refused. */
export async function sendEmailBatchResult(env: Env, msgs: SendArgs[]): Promise<SendResult> {
  if (msgs.length === 0) return { ok: true };
  if (msgs.length > BATCH_API_MAX) {
    return { ok: false, error: `batch of ${msgs.length} exceeds the API limit of ${BATCH_API_MAX}` };
  }
  if (!env.RESEND_API_KEY) {
    for (const msg of msgs) {
      console.log(`\n[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    }
    return { ok: true };
  }
  return postResend(env, "/emails/batch", msgs.map((msg) => resendPayload(env, msg)));
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

/** Sent the moment someone joins, to each admin whose own mode is "instant". */
export function newUserEmail(env: Env, u: NewUserSummary): SendArgs {
  const school = env.SCHOOL_NAME;
  const admin = `${env.APP_URL}/admin`;
  const what = VIA_LABEL[u.via];
  return {
    to: "",
    subject: `New sign-up: ${u.email}`,
    text: `${u.email} ${what} and joined the ${school} Directory.\n\n${fmtWhen(u.createdAt)}\n\nManage members: ${admin}\n\nYou're getting this because you turned on new-member emails for yourself. Turn them off in Admin → Notifications.`,
    html: `<p><strong>${esc(u.email)}</strong> ${what} and joined the <strong>${esc(school)} Directory</strong>.</p>
<p style="color:#56636f;font-size:13px">${fmtWhen(u.createdAt)}</p>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because you turned on new-member emails for yourself. Turn them off in Admin → Notifications.</p>`,
  };
}

/**
 * Somebody asked to read the directory (migration 0029).
 *
 * Deliberately thin. The applicant's address is here because it is how an
 * admin recognises the request and, for many families, who they are; the
 * child's name and the room they claim are NOT, because those are the claim
 * itself and belong on a screen behind a session rather than copied into
 * several inboxes. The link is the point of the message.
 */
export function accessRequestEmail(env: Env, req: { email: string }): SendArgs {
  const school = env.SCHOOL_NAME;
  const queue = `${env.APP_URL}/admin?tab=access`;
  return {
    to: "",
    subject: `Directory access requested: ${req.email}`,
    text: `${req.email} asked to read the ${school} Directory.

Review what they entered — their name, their child and the classroom they chose — and approve or decline:
${queue}

Until someone decides, they can use the calendar and the newsletter but cannot see any other family.`,
    html: `<p><strong>${esc(req.email)}</strong> asked to read the <strong>${esc(school)} Directory</strong>.</p>
<p>Review what they entered — their name, their child and the classroom they chose — and approve or decline:</p>
<p><a href="${queue}">Open the access queue</a></p>
<p style="color:#56636f;font-size:13px">Until someone decides, they can use the calendar and the newsletter but cannot see any other family.</p>`,
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
    text: `${heading}\n\n${lines.join("\n")}\n\nManage members: ${admin}\n\nYou're getting this because you chose the daily new-member digest. Change it in Admin → Notifications.`,
    html: `<p>${esc(heading)}.</p>
<ul>${rows}</ul>
<p><a href="${admin}">Manage members</a></p>
<p style="color:#56636f;font-size:13px">You're getting this because you chose the daily new-member digest. Change it in Admin → Notifications.</p>`,
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
    html: `<p><strong>${escapeHtml(who)}</strong> has been added to the <strong>${escapeHtml(school)} Directory</strong>.</p>
<p><a href="${link}">Sign in to view the directory and manage your profile</a></p>
<p style="color:#56636f;font-size:13px">This link expires in 14 days. If you weren't expecting this, you can ignore this email.</p>`,
  };
}

/** Invitation to control a Person.
 *
 *  The wording deliberately avoids "help manage {name}". This same email is now
 *  sent in two situations: a co-parent being given rights over a child, and —
 *  since the welcome wizard — somebody being invited to take over THEIR OWN
 *  profile, which a partner created for them. "Help manage Marcus Ruiz" reads
 *  as nonsense when you are Marcus. "Lets you manage the profile for {name}" is
 *  true and unremarkable either way, and avoids a possessive apostrophe on
 *  names that already end in s. */
export function inviteEmail(
  env: Env,
  link: string,
  inviterName: string,
  personName: string,
): SendArgs {
  const school = env.SCHOOL_NAME;
  // Both names are typed by a member and land in somebody else's inbox as
  // markup, so neither may be interpolated raw.
  const inviter = escapeHtml(inviterName);
  const person = escapeHtml(personName);
  return {
    to: "",
    subject: `${inviterName} invited you to the ${school} Directory`,
    text: `${inviterName} invited you to the ${school} Directory.\n\nAccepting lets you manage the profile for ${personName}.\n\nAccept: ${link}\n\nThis invitation expires in 14 days.`,
    html: `<p><strong>${inviter}</strong> invited you to the ${escapeHtml(school)} Directory.</p>
<p>Accepting lets you manage the profile for <strong>${person}</strong>.</p>
<p><a href="${link}">Accept invitation</a></p>
<p style="color:#56636f;font-size:13px">This invitation expires in 14 days.</p>`,
  };
}
