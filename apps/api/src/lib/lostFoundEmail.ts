// Lost & found photo intake by email (invariant 33).
//
// Staff mail a photo from their phone to the intake address (the Email Routing
// rule in EMAIL-INTAKE.md points it at this Worker) and the item lands in the
// staff review queue exactly as an app upload would: HELD from the first
// moment, described by the model, published only by a person pressing Publish.
// That hold is what makes an email channel acceptable at all — the worst a
// forged or mistaken message can do is put a photo in front of staff.
//
// Refusals, in order (src/email.ts applies the first two at SMTP time, BEFORE
// the message body is even parsed — a stranger's mail costs one indexed read,
// not a 25 MiB MIME parse):
//   1. An explicit SPF/DKIM/DMARC failure in Cloudflare's own
//      Authentication-Results header is rejected (`authFailed`). Softer
//      verdicts (none, softfail, no header) are ADMITTED, deliberately: many
//      legitimate domains publish no DMARC policy, and the hold bounds what a
//      forgery achieves — a held photo in front of staff. What a forgery
//      WOULD taint is attribution (`created_by`, the audit actor), so every
//      item's audit row records the DMARC verdict it arrived under
//      (`detail.dmarc`); a row minted by envelope forgery says "none", not
//      "pass". Tightening to require dmarc=pass is a one-line change here.
//   2. The envelope sender must be an ENABLED account on the lost & found
//      roster (`senderStaff` — `rosterAccess`, invariant 31, the same gate the
//      routes ask). Rejected at SMTP time, so a spoofed sender earns a refusal
//      inline, never a bounce mailed to the spoofed address.
//   3. Only attachments that ARE JPEGs — `isJpegBytes`, the upload route's own
//      sniff — under the route's own size cap become items; the rest are
//      counted and explained in the confirmation reply, never stored.
//
// One message never half-fails twice: a storage error on one attachment is
// caught, counted and reported, and the loop continues — a throw out of the
// intake after an item was created would lose that item's audit draft and
// make the sending MTA redeliver the whole message, duplicating every item
// already made. The intake throws only when NOTHING was created, where a
// redelivery is exactly the retry wanted.
//
// THUMBNAILS. The app upload path re-encodes photos through a canvas and sends
// a small thumbnail for the model to read; an email has only the full-size
// photo and a Worker has no canvas. With the optional IMAGES binding
// (absent-means-off, like AI), a real thumbnail is made here; without it the
// item is created with no thumbnail and the model reads the full photo —
// `tagItem` already falls back to `photo_key`.

import type { Env } from "../env.js";
import type { AuditDraft } from "./audit.js";
import { normalizeEmail } from "./db.js";
import { ulid } from "./ids.js";
import { LOSTFOUND_GROUP_SETTING, MAX_PHOTO_BYTES, cleanText, isJpegBytes, tagItem } from "./lostFound.js";
import { rosterAccess } from "./rosterGate.js";
import { nowIso } from "./time.js";
import type { SendArgs } from "./email.js";

/** Items one message may create. A phone's share sheet sends a handful; more
 *  than this is a mistake or a flood, and the reply says to send the rest in
 *  a second message. */
export const MAX_EMAIL_PHOTOS = 10;

/** One attachment as src/email.ts hands it over after parsing. */
export interface InboundAttachment {
  filename: string;
  mimeType: string;
  /** postal-mime's `related`: the part is referenced from the HTML by its
   *  Content-ID — usually a signature logo, sometimes a real photo a mail
   *  client chose to embed inline. */
  related: boolean;
  content: ArrayBuffer;
}

export interface InboundPhotoMail {
  subject: string;
  /** The DMARC verdict the message arrived under (`dmarcVerdict`), recorded on
   *  each item's audit row — see the header on why it is recorded, not gated. */
  dmarc: string;
  attachments: InboundAttachment[];
}

/** The verified account a message's envelope sender resolves to. */
export interface StaffSender {
  userId: string;
  email: string;
  isSystemAdmin: boolean;
}

export interface IntakeResult {
  outcome: "created" | "no_photos";
  /** Ids of the items created, in attachment order. */
  created: string[];
  /** Attachments that weren't usable JPEGs (wrong type, or too large). */
  skipped: number;
  /** Usable JPEGs beyond MAX_EMAIL_PHOTOS — resendable in a second message,
   *  so the reply must not lump them in with `skipped`'s "don't bother". */
  overflow: number;
  /** Usable JPEGs whose storage failed — resendable, counted separately for
   *  the same reason. */
  failed: number;
  /** Audit drafts for src/email.ts to flush — the same drafts the upload route
   *  would have pushed, written by the same `writeAudit` (invariant 5). */
  drafts: AuditDraft[];
}

/** Does Cloudflare's Authentication-Results header carry an explicit hard
 *  fail? See the header on why softer verdicts admit. */
export function authFailed(authenticationResults: string | null): boolean {
  return /\b(?:spf|dkim|dmarc)=fail\b/i.test(authenticationResults ?? "");
}

/** The DMARC verdict out of an Authentication-Results header: "pass", "none",
 *  …, or "absent" when the header carries no verdict at all. */
export function dmarcVerdict(authenticationResults: string | null): string {
  return /\bdmarc=([a-z]+)/i.exec(authenticationResults ?? "")?.[1]?.toLowerCase() ?? "absent";
}

/** Is this message machine-generated (an out-of-office, a bounce, our own
 *  confirmation come back through a forwarding rule)? Such a message may still
 *  CREATE items — a photo auto-forwarded is still a photo — but it must never
 *  be answered, or two autoresponders feed each other forever. */
export function isAutoGenerated(headers: { get(name: string): string | null }): boolean {
  const auto = (headers.get("auto-submitted") ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (headers.get("x-auto-response-suppress")) return true;
  const precedence = (headers.get("precedence") ?? "").trim().toLowerCase();
  return precedence === "bulk" || precedence === "junk" || precedence === "auto_reply";
}

/** Subject line → the item's location. "Fwd: gym" means the gym. */
export function locationOfSubject(subject: string): string {
  return cleanText(subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, ""), 120);
}

/** The sender's enabled account, if it may act as lost & found staff. Needs
 *  only the envelope address — callable, and called, before the body is
 *  parsed. */
export async function senderStaff(env: Env, from: string): Promise<StaffSender | null> {
  const email = normalizeEmail(from);
  if (!email) return null;
  const user = await env.DB.prepare(
    "SELECT id, email, is_system_admin FROM user WHERE email = ? AND disabled_at IS NULL",
  )
    .bind(email)
    .first<{ id: string; email: string; is_system_admin: number }>();
  if (!user) return null;
  const who = { userId: user.id, email: user.email, isSystemAdmin: user.is_system_admin === 1 };
  const access = await rosterAccess(env, LOSTFOUND_GROUP_SETTING, who);
  return access.canUse ? who : null;
}

/** A thumbnail for the model and the listings, if the IMAGES binding is there.
 *  Best-effort: any failure means "no thumbnail", never a lost photo. */
async function makeThumb(env: Env, photo: ArrayBuffer): Promise<ArrayBuffer | null> {
  if (!env.IMAGES) return null;
  try {
    const out = await env.IMAGES.input(new Response(photo).body!)
      .transform({ width: 800 })
      .output({ format: "image/jpeg", quality: 80 });
    return await out.response().arrayBuffer();
  } catch (err) {
    console.warn(`[lostfound] email thumbnail failed: ${String(err).slice(0, 120)}`);
    return null;
  }
}

/**
 * Turn one verified staff email into held items — the core src/email.ts calls
 * after `senderStaff` admitted the sender and the MIME parsed. `defer` is the
 * handler's `ctx.waitUntil`, carrying each item's model description past the
 * response the way the upload route's does.
 */
export async function intakeLostFoundEmail(
  env: Env,
  staff: StaffSender,
  mail: InboundPhotoMail,
  defer: (p: Promise<unknown>) => void,
): Promise<IntakeResult> {
  const location = locationOfSubject(mail.subject);
  const created: string[] = [];
  const drafts: AuditDraft[] = [];
  let skipped = 0;
  let overflow = 0;
  let failed = 0;
  let lastError: unknown = null;

  for (const a of mail.attachments) {
    if (!isJpegBytes(a.content) || a.content.byteLength > MAX_PHOTO_BYTES) {
      // An inline non-JPEG referenced from the HTML is almost always a
      // signature logo; counting it would make every reply claim something
      // was "skipped". An inline JPEG is NOT exempted the same way — some
      // mail clients embed the actual photo inline, and a junk item in the
      // held queue costs less than a real photo silently dropped.
      if (!a.related) skipped++;
      continue;
    }
    if (created.length >= MAX_EMAIL_PHOTOS) {
      overflow++;
      continue;
    }

    // One attachment's failure never aborts the message: an item already
    // created must keep its audit draft, and a thrown handler would make the
    // sender's MTA redeliver — duplicating it (see the header).
    try {
      const id = ulid();
      const photoKey = `${id}.jpg`;
      const thumb = await makeThumb(env, a.content);
      const thumbKey = thumb ? `${id}-thumb.jpg` : null;
      await env.LOSTFOUND_MEDIA.put(photoKey, a.content, { httpMetadata: { contentType: "image/jpeg" } });
      if (thumb && thumbKey) {
        await env.LOSTFOUND_MEDIA.put(thumbKey, thumb, { httpMetadata: { contentType: "image/jpeg" } });
      }
      const now = nowIso();
      try {
        await env.DB.prepare(
          `INSERT INTO lf_item (id, photo_key, thumb_key, location, search_text, held_at, found_at, created_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          // Held from the first moment, like the upload route: nobody has looked.
          .bind(id, photoKey, thumbKey, location, location.toLowerCase(), now, now, staff.userId, now)
          .run();
      } catch (err) {
        await env.LOSTFOUND_MEDIA.delete([photoKey, ...(thumbKey ? [thumbKey] : [])]);
        throw err;
      }
      drafts.push({
        action: "lostfound.item.created",
        entityKind: "lf_item",
        entityId: id,
        detail: { via: "email", dmarc: mail.dmarc },
      });
      created.push(id);
      // Described off the response path; the bytes in hand save a re-read.
      defer(tagItem(env, id, thumb ?? a.content));
    } catch (err) {
      console.error(`[lostfound] email intake failed to store a photo: ${String(err).slice(0, 200)}`);
      failed++;
      lastError = err;
    }
  }

  // Nothing committed and something broke: let the MTA redeliver — the retry
  // is safe precisely because no item exists yet.
  if (!created.length && failed > 0) throw lastError;

  return {
    outcome: created.length ? "created" : "no_photos",
    created,
    skipped,
    overflow,
    failed,
    drafts,
  };
}

/** The confirmation reply. Counts and a link only — none of the message's own
 *  content comes back (a reply can be forwarded; the queue is where photos
 *  live). Only ever addressed to the VERIFIED staff account, and marked
 *  auto-generated so nothing well-behaved answers it (`isAutoGenerated` is
 *  the other half of that loop guard). */
export function intakeReplyEmail(env: Env, staff: StaffSender, result: IntakeResult): SendArgs {
  const queue = `${env.LOSTFOUND_URL ?? ""}/staff`;
  const n = result.created.length;
  const lines = [
    n > 0
      ? `${n} ${n === 1 ? "photo" : "photos"} added to the lost & found, held for review.`
      : "No usable photo found — attach JPEG photos (most phones send JPEG; keep each under 6 MB).",
    result.skipped
      ? `${result.skipped} ${result.skipped === 1 ? "attachment was" : "attachments were"} skipped (not a JPEG, or too large).`
      : "",
    result.overflow
      ? `${result.overflow} ${result.overflow === 1 ? "photo was" : "photos were"} over the ${MAX_EMAIL_PHOTOS}-per-message limit — send the rest in a second message.`
      : "",
    result.failed
      ? `${result.failed} ${result.failed === 1 ? "photo" : "photos"} couldn't be stored — try sending ${result.failed === 1 ? "it" : "them"} again.`
      : "",
  ].filter(Boolean);
  const text = [...lines, n > 0 ? `Review and publish: ${queue}` : ""].filter(Boolean).join("\n\n");
  const html = [
    `<p>${lines[0]}</p>`,
    ...lines.slice(1).map((l) => `<p style="color:#56636f;font-size:13px">${l}</p>`),
    n > 0 ? `<p><a href="${queue}">Review and publish</a></p>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    to: staff.email,
    subject: n > 0 ? `Lost & found: ${n} ${n === 1 ? "item" : "items"} added` : "Lost & found: nothing added",
    text,
    html,
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
  };
}
