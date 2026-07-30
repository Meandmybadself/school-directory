// Newsletter domain logic. The route layer stays thin and delegates here, the
// same split managedCalendar.ts uses — and for the same reason: the interesting
// parts (audience arithmetic, slug derivation, settings coercion) are pure and
// worth unit-testing, which a Hono handler is not.
//
// Rendering is NOT here. It lives in @sd/shared's newsletterRender.ts so the
// composer's preview and the public archive page run exactly the same code the
// email did.

import type {
  CalendarEventDTO,
  NewsletterBrandingDTO,
  NewsletterNode,
  NewsletterSettingsDTO,
} from "@sd/shared";
import {
  collectEventsBlocks,
  renderNewsletterEmailHtml,
  renderNewsletterEmailText,
} from "@sd/shared";
import type { Env } from "../env.js";
import { queryUpcomingEvents } from "./calendar.js";
import { getSetting, normalizeEmail, setSetting } from "./db.js";
import type { SendArgs } from "./email.js";

const SETTINGS_KEY = "newsletter_settings";

/** Cap on events materialized into one block. A newsletter that lists 200
 *  events isn't a newsletter; this also bounds the frozen snapshot's size. */
const MAX_EVENTS_PER_BLOCK = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Append -2, -3, … until the slug is free. Two issues drafted the same day
 *  with the same title is ordinary, not an error worth rejecting. */
export async function uniqueSlug(env: Env, base: string, excludeId?: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const row = await env.DB.prepare("SELECT id FROM newsletter_issue WHERE slug = ?")
      .bind(candidate)
      .first<{ id: string }>();
    if (!row || row.id === excludeId) return candidate;
  }
  // 99 collisions on one base means something pathological; fall back to a
  // value that cannot collide rather than looping forever.
  return `${base}-${Date.now()}`;
}

// ── Settings ────────────────────────────────────────────────────────────────

// SCHOOL_NAME already carries the org's full name ("Eisenhower PTO"), so these
// templates append only the service word — never " School", which would read as
// "Eisenhower PTO School Newsletter".
export function defaultNewsletterSettings(env: Env): NewsletterSettingsDTO {
  const school = env.SCHOOL_NAME;
  return {
    senderName: school,
    // Empty means "use the instance-wide EMAIL_FROM". An admin can override it,
    // but only with an address Resend has verified for this domain.
    senderEmail: "",
    replyTo: null,
    footerText: `You're receiving this because you're part of the ${school} community.`,
    mailingAddress: "",
    unsubscribeWording: "Don't want these emails?",
    logoUrl: null,
    accentColor: "#0068A8",
    newsletterTitle: `${school} Newsletter`,
    defaultCalendarIds: [],
    defaultLookaheadDays: 14,
  };
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw.trim() : fallback;
}

/** Coerce arbitrary input onto the settings shape, field by field, falling back
 *  to `base` for anything missing or the wrong type. Pure, so the coercion
 *  rules are testable without a database. */
export function coerceNewsletterSettings(
  raw: unknown,
  base: NewsletterSettingsDTO,
): NewsletterSettingsDTO {
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const senderEmail = str(r.senderEmail, base.senderEmail).toLowerCase();
  const replyTo = typeof r.replyTo === "string" ? r.replyTo.trim().toLowerCase() : base.replyTo;
  const lookahead =
    typeof r.defaultLookaheadDays === "number" && Number.isFinite(r.defaultLookaheadDays)
      ? Math.min(Math.max(Math.round(r.defaultLookaheadDays), 1), 365)
      : base.defaultLookaheadDays;
  return {
    senderName: str(r.senderName, base.senderName),
    // A malformed sender address would bounce every send, so it is dropped back
    // to "use EMAIL_FROM" rather than stored and silently failing later.
    senderEmail: senderEmail === "" || isEmail(senderEmail) ? senderEmail : base.senderEmail,
    replyTo: replyTo && isEmail(replyTo) ? replyTo : null,
    footerText: str(r.footerText, base.footerText),
    mailingAddress: str(r.mailingAddress, base.mailingAddress),
    unsubscribeWording: str(r.unsubscribeWording, base.unsubscribeWording),
    logoUrl: typeof r.logoUrl === "string" && /^https?:\/\//i.test(r.logoUrl.trim())
      ? r.logoUrl.trim()
      : r.logoUrl === null
        ? null
        : base.logoUrl,
    accentColor: typeof r.accentColor === "string" && HEX_COLOR.test(r.accentColor.trim())
      ? r.accentColor.trim()
      : base.accentColor,
    newsletterTitle: str(r.newsletterTitle, base.newsletterTitle),
    defaultCalendarIds: Array.isArray(r.defaultCalendarIds)
      ? r.defaultCalendarIds.filter((v): v is string => typeof v === "string")
      : base.defaultCalendarIds,
    defaultLookaheadDays: lookahead,
  };
}

export async function getNewsletterSettings(env: Env): Promise<NewsletterSettingsDTO> {
  const base = defaultNewsletterSettings(env);
  const stored = await getSetting(env, SETTINGS_KEY);
  if (!stored) return base;
  try {
    return coerceNewsletterSettings(JSON.parse(stored), base);
  } catch {
    console.error("[newsletter] stored settings are not valid JSON; using defaults");
    return base;
  }
}

export async function setNewsletterSettings(
  env: Env,
  settings: NewsletterSettingsDTO,
): Promise<void> {
  await setSetting(env, SETTINGS_KEY, JSON.stringify(settings));
}

/** The subset of settings a public page may see — no sender identity. */
export function brandingOf(settings: NewsletterSettingsDTO): NewsletterBrandingDTO {
  return {
    newsletterTitle: settings.newsletterTitle,
    accentColor: settings.accentColor,
    logoUrl: settings.logoUrl,
    footerText: settings.footerText,
  };
}

// ── Audience ────────────────────────────────────────────────────────────────

export interface AudienceMember {
  email: string;
  userId: string | null;
  subscriberId: string | null;
}

export interface AudienceUserRow {
  id: string;
  email: string;
  optedOut: boolean;
}

export interface AudienceSubscriberRow {
  id: string;
  email: string;
  unsubscribed: boolean;
}

/** Combine the two recipient sources into one deduped list.
 *
 *  A member's opt-out is authoritative over any standalone subscriber row for
 *  the same address: otherwise unsubscribing from the member preferences screen
 *  would silently fail to stop the mail whenever an admin had also added that
 *  address to the subscriber list, which is exactly the kind of "I unsubscribed
 *  and it kept coming" bug that gets a sender blocklisted. */
export function mergeAudience(
  users: AudienceUserRow[],
  subscribers: AudienceSubscriberRow[],
): AudienceMember[] {
  const byEmail = new Map<string, AudienceMember>();
  const blocked = new Set<string>();

  for (const u of users) {
    const email = normalizeEmail(u.email);
    if (!email) continue;
    if (u.optedOut) {
      blocked.add(email);
      byEmail.delete(email);
      continue;
    }
    if (!byEmail.has(email)) byEmail.set(email, { email, userId: u.id, subscriberId: null });
  }

  for (const s of subscribers) {
    const email = normalizeEmail(s.email);
    if (!email || s.unsubscribed || blocked.has(email)) continue;
    const existing = byEmail.get(email);
    if (existing) {
      // Same person reachable two ways — one email, but remember both handles
      // so an unsubscribe can clear whichever one is doing the sending.
      existing.subscriberId = s.id;
      continue;
    }
    byEmail.set(email, { email, userId: null, subscriberId: s.id });
  }

  return [...byEmail.values()];
}

/** Everyone who should receive the next issue. */
export async function resolveAudience(env: Env): Promise<AudienceMember[]> {
  const [users, subs] = await Promise.all([
    env.DB.prepare(
      "SELECT id, email, newsletter_opt_out_at FROM user WHERE disabled_at IS NULL",
    ).all<{ id: string; email: string; newsletter_opt_out_at: string | null }>(),
    env.DB.prepare(
      "SELECT id, email, unsubscribed_at FROM newsletter_subscriber",
    ).all<{ id: string; email: string; unsubscribed_at: string | null }>(),
  ]);

  return mergeAudience(
    users.results.map((u) => ({ id: u.id, email: u.email, optedOut: u.newsletter_opt_out_at !== null })),
    subs.results.map((s) => ({ id: s.id, email: s.email, unsubscribed: s.unsubscribed_at !== null })),
  );
}

// ── Events blocks ───────────────────────────────────────────────────────────

/** Resolve every events block in a document to its event list.
 *
 *  Called twice with the same code path: by the composer's preview endpoint
 *  (live, so a draft edited over several days stays accurate) and once more at
 *  send time, when the result is frozen into the issue so the archive keeps
 *  showing what was actually mailed. */
export async function resolveEventsSnapshot(
  env: Env,
  doc: NewsletterNode,
  fromIso: string,
): Promise<Record<string, CalendarEventDTO[]>> {
  const blocks = collectEventsBlocks(doc);
  const snapshot: Record<string, CalendarEventDTO[]> = {};
  const fromMs = new Date(fromIso).getTime();

  for (const block of blocks) {
    if (!block.blockId) continue;
    const to = new Date(fromMs + block.lookaheadDays * DAY_MS).toISOString();
    snapshot[block.blockId] = await queryUpcomingEvents(env, {
      from: fromIso,
      to,
      calendarIds: block.calendarIds,
      limit: MAX_EVENTS_PER_BLOCK,
    });
  }
  return snapshot;
}

/** Look events up out of a frozen snapshot. Blocks added after the freeze (only
 *  possible via a malformed request, since sent issues are immutable) render
 *  empty rather than throwing. */
export function snapshotResolver(snapshot: Record<string, CalendarEventDTO[]>) {
  return (attrs: { blockId: string }) => snapshot[attrs.blockId] ?? [];
}

// ── Email composition ───────────────────────────────────────────────────────

export interface IssueEmailInput {
  env: Env;
  settings: NewsletterSettingsDTO;
  issue: {
    slug: string;
    title: string;
    subtitle: string | null;
    subject: string;
    content: NewsletterNode;
  };
  snapshot: Record<string, CalendarEventDTO[]>;
  /** Per-recipient token; the test-send path passes null and links to the
   *  preferences screen instead, so a test can't unsubscribe anyone. */
  unsubscribeToken: string | null;
  /** Prefixes the subject so a test never looks like the real thing in an inbox. */
  isTest?: boolean;
}

export function issueWebUrl(env: Env, slug: string): string {
  return `${env.NEWSLETTER_URL}/n/${slug}`;
}

export function unsubscribeUrl(env: Env, token: string | null): string {
  return token
    ? `${env.NEWSLETTER_URL}/unsubscribe/${token}`
    : `${env.NEWSLETTER_URL}/preferences`;
}

/** Build the message for one recipient. `to` is left empty for the caller to
 *  fill, matching every other builder in lib/email.ts. */
export function issueEmailArgs(input: IssueEmailInput): SendArgs {
  const { env, settings, issue, snapshot } = input;
  const wrapper = {
    branding: brandingOf(settings),
    title: issue.title,
    subtitle: issue.subtitle,
    doc: issue.content,
    resolveEvents: snapshotResolver(snapshot),
    timeZone: env.SCHOOL_TIMEZONE,
    unsubscribeUrl: unsubscribeUrl(env, input.unsubscribeToken),
    unsubscribeWording: settings.unsubscribeWording,
    mailingAddress: settings.mailingAddress,
    webUrl: issueWebUrl(env, issue.slug),
  };
  return {
    to: "",
    subject: input.isTest ? `[TEST] ${issue.subject}` : issue.subject,
    html: renderNewsletterEmailHtml(wrapper),
    text: renderNewsletterEmailText(wrapper),
    from: settings.senderEmail
      ? `${settings.senderName} <${settings.senderEmail}>`
      : undefined,
    replyTo: settings.replyTo ?? undefined,
  };
}
