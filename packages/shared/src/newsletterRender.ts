// The one newsletter renderer. A newsletter issue is stored as a TipTap
// (ProseMirror) JSON document; this module turns that document into HTML three
// times over — the email that gets mailed, the live preview in the composer,
// and the public archive page — so those three can never disagree about what an
// issue says. It is the same reasoning as the calendar's "one recurrence
// engine" rule (CLAUDE.md invariant 9), applied to prose.
//
// Two things follow from being the only renderer:
//
//   1. It is PURE and dependency-free. No DOM, no prosemirror-model. TipTap's
//      own `generateHTML` goes through DOMSerializer, which needs a `document`
//      that neither Workers nor Pages Functions have.
//
//   2. It is the sanitizer. Rendering switches over a fixed allowlist of node
//      and mark types and escapes every text value on the way out, so it
//      CANNOT emit a tag it doesn't know about — there is no string
//      pass-through anywhere. `sanitizeNewsletterDoc` applies the identical
//      allowlist at write time, so a hand-crafted PATCH that bypasses the
//      editor is rejected before it is ever stored.
//
// Events are resolved, not stored: a caller supplies `resolveEvents`, which
// looks up one block's events live (while drafting) or from the frozen snapshot
// (at send time and forever after on the archive page). Data resolution is
// impure and differs per call site; rendering is pure and identical.

import type {
  CalendarEventDTO,
  NewsletterBrandingDTO,
  NewsletterEventsBlockAttrs,
  NewsletterNode,
} from "./types.js";
import { EVENTS_BLOCK_TYPE } from "./types.js";

/** Resolves one events block to the events it should render. */
export type EventsResolver = (attrs: NewsletterEventsBlockAttrs) => CalendarEventDTO[];

/** No events anywhere — for excerpts and other text-only passes. */
export const NO_EVENTS: EventsResolver = () => [];

export interface NewsletterRenderOptions {
  /** `email` inlines every style (clients strip <style> unpredictably);
   *  `web` emits class names styled by NEWSLETTER_WEB_CSS. */
  mode: "email" | "web";
  accentColor?: string;
  /** Zone used to name the day/time of a *timed* event. All-day events denote a
   *  calendar date and are always read in UTC (see the note in
   *  apps/web/src/lib/calendar.ts). There is no viewer zone on the server, so
   *  this has to be stated rather than inferred. */
  timeZone?: string;
  locale?: string;
}

const DEFAULT_ACCENT = "#0068A8";
const DEFAULT_TIME_ZONE = "America/Chicago";
const DEFAULT_LOCALE = "en-US";

const INK = "#1F2933";
const MUTED = "#56636F";
const RULE = "#E4E7EB";
const PAPER = "#FFFFFF";
const BACKDROP = "#F4F6F8";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/** Heading levels TipTap is configured to produce. Anything else is demoted. */
const HEADING_LEVELS = [1, 2, 3] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only protocols that are safe to put in front of a reader. Notably excludes
 *  `javascript:` and `data:`. */
function safeLinkHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

/** Images must be real remote URLs — an inbox can't render a relative path, and
 *  `data:` URIs are both a bloat and an obfuscation vector. */
function safeImageSrc(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const src = raw.trim();
  return /^https?:\/\//i.test(src) ? src : null;
}

// ── Sanitization ────────────────────────────────────────────────────────────

const ALLOWED_MARKS = new Set(["bold", "italic", "strike", "code", "link"]);
const ALLOWED_BLOCKS = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "image",
  EVENTS_BLOCK_TYPE,
]);

function sanitizeMarks(raw: unknown): NewsletterNode["marks"] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<NewsletterNode["marks"]> = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const type = (m as { type?: unknown }).type;
    if (typeof type !== "string" || !ALLOWED_MARKS.has(type)) continue;
    if (type === "link") {
      const href = safeLinkHref((m as { attrs?: { href?: unknown } }).attrs?.href);
      // A link mark with an unusable href becomes plain text rather than a
      // dead or dangerous anchor.
      if (!href) continue;
      out.push({ type, attrs: { href } });
      continue;
    }
    out.push({ type });
  }
  return out.length > 0 ? out : undefined;
}

function clampLookahead(raw: unknown): number {
  const n = typeof raw === "number" ? Math.round(raw) : Number.NaN;
  if (!Number.isFinite(n)) return 14;
  return Math.min(Math.max(n, 1), 365);
}

function sanitizeNode(raw: unknown, path: string): NewsletterNode | NewsletterNode[] | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as Record<string, unknown>;
  const type = node.type;
  if (typeof type !== "string") return null;

  if (type === "text") {
    const text = typeof node.text === "string" ? node.text : "";
    if (!text) return null;
    const marks = sanitizeMarks(node.marks);
    return marks ? { type: "text", text, marks } : { type: "text", text };
  }

  const children = Array.isArray(node.content)
    ? node.content.flatMap((child, i) => {
        const s = sanitizeNode(child, `${path}.${i}`);
        return s == null ? [] : Array.isArray(s) ? s : [s];
      })
    : [];

  // An unrecognized node keeps its text — the same strip-tag-keep-content
  // philosophy as text.ts's htmlToText — rather than silently eating content.
  if (!ALLOWED_BLOCKS.has(type)) return children.length > 0 ? children : null;

  switch (type) {
    case "heading": {
      const raw = (node.attrs as { level?: unknown } | undefined)?.level;
      const lvl = typeof raw === "number" ? raw : 2;
      const level = (HEADING_LEVELS as readonly number[]).includes(lvl) ? lvl : 3;
      return { type, attrs: { level }, content: children };
    }
    case "image": {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      const src = safeImageSrc(attrs.src);
      if (!src) return null;
      const alt = typeof attrs.alt === "string" ? attrs.alt : "";
      return { type, attrs: { src, alt } };
    }
    case EVENTS_BLOCK_TYPE: {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>;
      const heading = typeof attrs.heading === "string" && attrs.heading.trim()
        ? attrs.heading.trim()
        : null;
      return {
        type,
        attrs: {
          // Positional fallback: stable for a given document shape, so a block
          // whose id went missing still keys consistently into the snapshot.
          blockId:
            typeof attrs.blockId === "string" && attrs.blockId ? attrs.blockId : `block${path}`,
          calendarIds: Array.isArray(attrs.calendarIds)
            ? attrs.calendarIds.filter((v): v is string => typeof v === "string")
            : [],
          lookaheadDays: clampLookahead(attrs.lookaheadDays),
          heading,
        },
      };
    }
    case "horizontalRule":
    case "hardBreak":
      return { type };
    default:
      return { type, content: children };
  }
}

/** Apply the render allowlist at write time. Returns null when the input isn't
 *  a document at all; an empty document is valid and renders as nothing. */
export function sanitizeNewsletterDoc(raw: unknown): NewsletterNode | null {
  if (!raw || typeof raw !== "object") return null;
  if ((raw as { type?: unknown }).type !== "doc") return null;
  const doc = sanitizeNode(raw, "0");
  if (!doc || Array.isArray(doc) || doc.type !== "doc") return null;
  return doc;
}

/** Every events block in the document, in order. Used to know what to resolve
 *  live while drafting and what to freeze at send time. */
export function collectEventsBlocks(doc: NewsletterNode): NewsletterEventsBlockAttrs[] {
  const out: NewsletterEventsBlockAttrs[] = [];
  const walk = (n: NewsletterNode) => {
    if (n.type === EVENTS_BLOCK_TYPE) out.push(eventsAttrs(n));
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

function eventsAttrs(n: NewsletterNode): NewsletterEventsBlockAttrs {
  const a = (n.attrs ?? {}) as Record<string, unknown>;
  return {
    blockId: typeof a.blockId === "string" ? a.blockId : "",
    calendarIds: Array.isArray(a.calendarIds)
      ? a.calendarIds.filter((v): v is string => typeof v === "string")
      : [],
    lookaheadDays: clampLookahead(a.lookaheadDays),
    heading: typeof a.heading === "string" && a.heading ? a.heading : null,
  };
}

// ── Event formatting ────────────────────────────────────────────────────────

/** Day label for an event. All-day values are calendar dates stored at midnight
 *  UTC and must be read in UTC; timed values are instants read in `timeZone`. */
export function formatEventDay(
  e: CalendarEventDTO,
  locale: string,
  timeZone: string,
): string {
  return new Date(e.start).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: e.allDay ? "UTC" : timeZone,
  });
}

/** Time label, or null for all-day events (which have no meaningful time). */
export function formatEventTime(
  e: CalendarEventDTO,
  locale: string,
  timeZone: string,
): string | null {
  if (e.allDay) return null;
  return new Date(e.start).toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

// ── HTML rendering ──────────────────────────────────────────────────────────

interface Ctx {
  mode: "email" | "web";
  accent: string;
  timeZone: string;
  locale: string;
  resolve: EventsResolver;
}

/** Emit either an inline `style` attribute (email) or a class (web), so one set
 *  of node handlers serves both targets. */
function attr(ctx: Ctx, cls: string, style: string): string {
  return ctx.mode === "email" ? ` style="${style}"` : ` class="${cls}"`;
}

function renderText(node: NewsletterNode): string {
  let html = escapeHtml(node.text ?? "");
  // Marks wrap outward-in; link is applied last so it ends up outermost.
  for (const m of node.marks ?? []) {
    switch (m.type) {
      case "bold":
        html = `<strong>${html}</strong>`;
        break;
      case "italic":
        html = `<em>${html}</em>`;
        break;
      case "strike":
        html = `<s>${html}</s>`;
        break;
      case "code":
        html = `<code>${html}</code>`;
        break;
      default:
        break;
    }
  }
  const link = (node.marks ?? []).find((m) => m.type === "link");
  if (link) {
    const href = safeLinkHref(link.attrs?.href);
    if (href) {
      html = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${html}</a>`;
    }
  }
  return html;
}

function renderChildren(nodes: NewsletterNode[] | undefined, ctx: Ctx): string {
  return (nodes ?? []).map((n) => renderNode(n, ctx)).join("");
}

function renderEventsBlock(node: NewsletterNode, ctx: Ctx): string {
  const attrs = eventsAttrs(node);
  const events = ctx.resolve(attrs);
  const parts: string[] = [];

  if (attrs.heading) {
    parts.push(
      `<h2${attr(ctx, "nl-events-heading", `margin:28px 0 10px;font-size:19px;line-height:1.3;font-weight:700;color:${INK};font-family:${FONT}`)}>${escapeHtml(attrs.heading)}</h2>`,
    );
  }

  if (events.length === 0) {
    parts.push(
      `<p${attr(ctx, "nl-events-empty", `margin:0 0 18px;font-size:15px;color:${MUTED};font-family:${FONT}`)}>No upcoming events.</p>`,
    );
    return parts.join("");
  }

  // A table, not a flex/grid list: Outlook's rendering engine is Word's, and a
  // table is the only layout primitive it handles predictably.
  const rows = events
    .map((e) => {
      const day = formatEventDay(e, ctx.locale, ctx.timeZone);
      const time = formatEventTime(e, ctx.locale, ctx.timeZone);
      const when = [day, time].filter(Boolean).join(" · ");
      const meta = [when, e.location].filter(Boolean).join(" — ");
      const bar = e.source.color || ctx.accent;
      return `<tr><td${attr(ctx, "nl-event", `padding:10px 0 10px 12px;border-left:3px solid ${escapeHtml(bar)};border-bottom:1px solid ${RULE}`)}>
<div${attr(ctx, "nl-event-title", `font-size:15px;font-weight:600;color:${INK};font-family:${FONT};line-height:1.4`)}>${escapeHtml(e.title)}</div>
<div${attr(ctx, "nl-event-meta", `font-size:13px;color:${MUTED};font-family:${FONT};margin-top:2px`)}>${escapeHtml(meta)}</div>
</td></tr>`;
    })
    .join("");

  parts.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${attr(ctx, "nl-events", "width:100%;border-collapse:collapse;margin:0 0 20px")}>${rows}</table>`,
  );
  return parts.join("");
}

function renderNode(node: NewsletterNode, ctx: Ctx): string {
  switch (node.type) {
    case "doc":
      return renderChildren(node.content, ctx);
    case "text":
      return renderText(node);
    case "paragraph": {
      const inner = renderChildren(node.content, ctx);
      // An empty paragraph is deliberate vertical space in the editor; keep it.
      if (!inner) return `<p${attr(ctx, "nl-p", "margin:0 0 16px;height:8px")}></p>`;
      return `<p${attr(ctx, "nl-p", `margin:0 0 16px;font-size:16px;line-height:1.65;color:${INK};font-family:${FONT}`)}>${inner}</p>`;
    }
    case "heading": {
      const level = (node.attrs as { level?: number } | undefined)?.level ?? 2;
      const size = level === 1 ? 26 : level === 2 ? 21 : 17;
      const top = level === 1 ? 0 : 28;
      return `<h${level}${attr(ctx, `nl-h${level}`, `margin:${top}px 0 12px;font-size:${size}px;line-height:1.3;font-weight:700;color:${INK};font-family:${FONT}`)}>${renderChildren(node.content, ctx)}</h${level}>`;
    }
    case "bulletList":
      return `<ul${attr(ctx, "nl-ul", `margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.65;color:${INK};font-family:${FONT}`)}>${renderChildren(node.content, ctx)}</ul>`;
    case "orderedList":
      return `<ol${attr(ctx, "nl-ol", `margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.65;color:${INK};font-family:${FONT}`)}>${renderChildren(node.content, ctx)}</ol>`;
    case "listItem": {
      // TipTap wraps each item's text in a paragraph; unwrap the single-child
      // case so list items don't inherit the paragraph's bottom margin.
      const kids = node.content ?? [];
      const inner =
        kids.length === 1 && kids[0]?.type === "paragraph"
          ? renderChildren(kids[0].content, ctx)
          : renderChildren(kids, ctx);
      return `<li${attr(ctx, "nl-li", "margin:0 0 6px")}>${inner}</li>`;
    }
    case "blockquote":
      return `<blockquote${attr(ctx, "nl-quote", `margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid ${ctx.accent};color:${MUTED};font-style:italic`)}>${renderChildren(node.content, ctx)}</blockquote>`;
    case "horizontalRule":
      return `<hr${attr(ctx, "nl-hr", `border:0;border-top:1px solid ${RULE};margin:26px 0`)} />`;
    case "hardBreak":
      return "<br />";
    case "image": {
      const a = (node.attrs ?? {}) as { src?: string; alt?: string };
      const src = safeImageSrc(a.src);
      if (!src) return "";
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(a.alt ?? "")}"${attr(ctx, "nl-img", "display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 18px")} />`;
    }
    case EVENTS_BLOCK_TYPE:
      return renderEventsBlock(node, ctx);
    default:
      // Unreachable for sanitized input; render children rather than vanish.
      return renderChildren(node.content, ctx);
  }
}

/** The issue body only — no masthead, no footer. Callers wrap it. */
export function renderNewsletterBodyHtml(
  doc: NewsletterNode,
  resolveEvents: EventsResolver,
  opts: NewsletterRenderOptions,
): string {
  return renderNode(doc, {
    mode: opts.mode,
    accent: opts.accentColor || DEFAULT_ACCENT,
    timeZone: opts.timeZone || DEFAULT_TIME_ZONE,
    locale: opts.locale || DEFAULT_LOCALE,
    resolve: resolveEvents,
  });
}

// ── Plain text ──────────────────────────────────────────────────────────────

/** Plain-text alternative for the email's `text` part. Also the basis for
 *  archive excerpts and OG descriptions. */
export function renderNewsletterText(
  doc: NewsletterNode,
  resolveEvents: EventsResolver,
  opts: Pick<NewsletterRenderOptions, "timeZone" | "locale"> = {},
): string {
  const timeZone = opts.timeZone || DEFAULT_TIME_ZONE;
  const locale = opts.locale || DEFAULT_LOCALE;
  const out: string[] = [];

  const inline = (n: NewsletterNode): string => {
    if (n.type === "text") {
      const link = (n.marks ?? []).find((m) => m.type === "link");
      const href = link ? safeLinkHref(link.attrs?.href) : null;
      // Plain text can't hyperlink, so a link's destination is spelled out.
      return href ? `${n.text ?? ""} (${href})` : n.text ?? "";
    }
    if (n.type === "hardBreak") return "\n";
    return (n.content ?? []).map(inline).join("");
  };

  const block = (n: NewsletterNode, depth: number) => {
    switch (n.type) {
      case "doc":
        for (const c of n.content ?? []) block(c, depth);
        break;
      case "paragraph":
      case "blockquote":
        out.push(inline(n));
        break;
      case "heading":
        out.push(inline(n).toUpperCase());
        break;
      case "bulletList":
      case "orderedList":
        (n.content ?? []).forEach((li, i) => {
          const marker = n.type === "orderedList" ? `${i + 1}.` : "•";
          out.push(`${marker} ${inline(li).trim()}`);
        });
        break;
      case "horizontalRule":
        out.push("—".repeat(24));
        break;
      case "image":
        break;
      case EVENTS_BLOCK_TYPE: {
        const attrs = eventsAttrs(n);
        if (attrs.heading) out.push(attrs.heading.toUpperCase());
        const events = resolveEvents(attrs);
        if (events.length === 0) {
          out.push("No upcoming events.");
          break;
        }
        for (const e of events) {
          const when = [formatEventDay(e, locale, timeZone), formatEventTime(e, locale, timeZone)]
            .filter(Boolean)
            .join(" · ");
          out.push(`• ${e.title} — ${[when, e.location].filter(Boolean).join(" — ")}`);
        }
        break;
      }
      default:
        for (const c of n.content ?? []) block(c, depth);
    }
  };

  block(doc, 0);
  return out
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Drop events blocks from a copy of the document. An excerpt is meant to be the
 *  issue's own words; rendering a block here would either inline a list of events
 *  or — worse — emit its heading followed by "No upcoming events", which reads as
 *  though the issue said that. */
function withoutEventsBlocks(node: NewsletterNode): NewsletterNode {
  if (!node.content) return node;
  return {
    ...node,
    content: node.content
      .filter((c) => c.type !== EVENTS_BLOCK_TYPE)
      .map(withoutEventsBlocks),
  };
}

/** Short summary for archive cards and og:description. */
export function newsletterExcerpt(doc: NewsletterNode, max = 180): string {
  const text = renderNewsletterText(withoutEventsBlocks(doc), NO_EVENTS)
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// ── Whole-document wrappers ─────────────────────────────────────────────────

export interface NewsletterWrapperInput {
  branding: NewsletterBrandingDTO;
  title: string;
  subtitle: string | null;
  doc: NewsletterNode;
  resolveEvents: EventsResolver;
  timeZone?: string;
  locale?: string;
}

export interface NewsletterEmailInput extends NewsletterWrapperInput {
  /** Per-recipient one-click unsubscribe target. */
  unsubscribeUrl: string;
  unsubscribeWording: string;
  mailingAddress: string;
  /** Public archive URL for the "view in browser" link. */
  webUrl: string;
}

function masthead(branding: NewsletterBrandingDTO, accent: string): string {
  if (branding.logoUrl) {
    return `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" style="display:block;max-width:220px;height:auto;margin:0 auto 6px" />`;
  }
  return `<div style="font-size:18px;font-weight:700;color:${accent};font-family:${FONT};text-align:center;letter-spacing:.02em">${escapeHtml(branding.newsletterTitle)}</div>`;
}

/** The complete HTML email. Everything is inlined and table-wrapped: email
 *  clients strip <style> blocks and Outlook lays out with Word's engine. */
export function renderNewsletterEmailHtml(input: NewsletterEmailInput): string {
  const accent = input.branding.accentColor || DEFAULT_ACCENT;
  const body = renderNewsletterBodyHtml(input.doc, input.resolveEvents, {
    mode: "email",
    accentColor: accent,
    timeZone: input.timeZone,
    locale: input.locale,
  });
  const subtitle = input.subtitle
    ? `<div style="font-size:15px;color:${MUTED};font-family:${FONT};margin-top:4px">${escapeHtml(input.subtitle)}</div>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:${BACKDROP};-webkit-text-size-adjust:100%">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BACKDROP};padding:24px 12px">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:${PAPER};border-radius:12px;overflow:hidden">
<tr><td style="padding:22px 28px 0">
${masthead(input.branding, accent)}
<div style="text-align:center;margin-top:14px"><a href="${escapeHtml(input.webUrl)}" style="font-size:12px;color:${MUTED};font-family:${FONT}">View this in your browser</a></div>
<div style="height:1px;background:${RULE};margin:16px 0 22px"></div>
<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:${INK};font-family:${FONT}">${escapeHtml(input.title)}</h1>
${subtitle}
<div style="height:20px"></div>
</td></tr>
<tr><td style="padding:0 28px 8px">
${body}
</td></tr>
<tr><td style="padding:8px 28px 26px;border-top:1px solid ${RULE}">
<p style="margin:16px 0 8px;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${escapeHtml(input.branding.footerText)}</p>
<p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${escapeHtml(input.mailingAddress)}</p>
<p style="margin:0;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${escapeHtml(input.unsubscribeWording)} <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${accent}">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function renderNewsletterEmailText(input: NewsletterEmailInput): string {
  const body = renderNewsletterText(input.doc, input.resolveEvents, {
    timeZone: input.timeZone,
    locale: input.locale,
  });
  return [
    input.title,
    input.subtitle ?? "",
    "",
    body,
    "",
    "—".repeat(24),
    `View in your browser: ${input.webUrl}`,
    input.branding.footerText,
    input.mailingAddress,
    `${input.unsubscribeWording} ${input.unsubscribeUrl}`,
  ]
    .filter((s) => s !== "")
    .join("\n\n");
}

/** Stylesheet for the public archive pages. Lives here so the web target's look
 *  is defined next to the email's inline styles and the two stay in step. */
export const NEWSLETTER_WEB_CSS = `
*{box-sizing:border-box}
body{margin:0;background:${BACKDROP};color:${INK};font-family:${FONT};-webkit-font-smoothing:antialiased}
a{color:var(--nl-accent,${DEFAULT_ACCENT})}
.nl-wrap{max-width:680px;margin:0 auto;padding:24px 16px 56px}
.nl-card{background:${PAPER};border-radius:14px;padding:28px 28px 32px;box-shadow:0 1px 3px rgba(16,24,40,.06)}
.nl-masthead{text-align:center;padding:8px 0 20px}
.nl-masthead img{max-width:220px;height:auto;display:inline-block}
.nl-masthead-title{font-size:18px;font-weight:700;color:var(--nl-accent,${DEFAULT_ACCENT});letter-spacing:.02em}
.nl-title{margin:0;font-size:30px;line-height:1.2;font-weight:700}
.nl-subtitle{margin:6px 0 0;font-size:16px;color:${MUTED}}
.nl-date{margin:10px 0 0;font-size:13px;color:${MUTED}}
.nl-body{margin-top:26px}
.nl-p{margin:0 0 16px;font-size:17px;line-height:1.7}
.nl-h1{margin:0 0 12px;font-size:26px;line-height:1.3;font-weight:700}
.nl-h2{margin:28px 0 12px;font-size:21px;line-height:1.3;font-weight:700}
.nl-h3{margin:28px 0 12px;font-size:17px;line-height:1.3;font-weight:700}
.nl-ul,.nl-ol{margin:0 0 16px;padding-left:22px;font-size:17px;line-height:1.7}
.nl-li{margin:0 0 6px}
.nl-quote{margin:0 0 16px;padding:2px 0 2px 14px;border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT});color:${MUTED};font-style:italic}
.nl-hr{border:0;border-top:1px solid ${RULE};margin:26px 0}
.nl-img{display:block;max-width:100%;height:auto;border-radius:8px;margin:0 0 18px}
.nl-events{width:100%;border-collapse:collapse;margin:0 0 20px}
.nl-events-heading{margin:28px 0 10px;font-size:19px;line-height:1.3;font-weight:700}
.nl-events-empty{margin:0 0 18px;font-size:15px;color:${MUTED}}
.nl-event{padding:10px 0 10px 12px;border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT});border-bottom:1px solid ${RULE}}
.nl-event-title{font-size:15px;font-weight:600;line-height:1.4}
.nl-event-meta{font-size:13px;color:${MUTED};margin-top:2px}
.nl-foot{margin-top:22px;padding-top:18px;border-top:1px solid ${RULE};font-size:13px;line-height:1.6;color:${MUTED}}
.nl-archive-item{display:block;background:${PAPER};border-radius:12px;padding:18px 20px;margin-bottom:12px;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(16,24,40,.06)}
.nl-archive-item h2{margin:0;font-size:19px;line-height:1.3}
.nl-archive-item p{margin:6px 0 0;font-size:14.5px;line-height:1.55;color:${MUTED}}
.nl-archive-date{display:block;font-size:12.5px;color:${MUTED};margin-bottom:4px}
.nl-empty{background:${PAPER};border-radius:12px;padding:40px 20px;text-align:center;color:${MUTED}}
@media (max-width:520px){.nl-card{padding:22px 18px 26px}.nl-title{font-size:25px}}
`.trim();
