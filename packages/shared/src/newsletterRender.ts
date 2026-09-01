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
// The ONE exception is the settings footer, where an admin may hand-write HTML.
// It goes through `sanitizeFooterHtml` below, which is a tag-level allowlist
// with the same "can't emit what it doesn't know" property, and it is applied at
// write time so nothing unsanitized is ever stored. Do not add a second raw-HTML
// seam without routing it through that function.
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
import { visibleEvents } from "./newsletterEvents.js";
import { eventPath, type EventPathInput } from "./eventPath.js";
import { htmlToText } from "./text.js";

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
  /** Public calendar site. When set, every events block gets a "See all events"
   *  link out to it. Omitted → no link, so a deployment without a calendar host
   *  configured renders exactly as it did before. */
  calendarUrl?: string;
}

const DEFAULT_ACCENT = "#0068A8";
/** Used whenever a caller has no zone to offer. Exported because the API and the
 *  composer both need to fall back to the same one the renderer would. */
export const DEFAULT_TIME_ZONE = "America/Chicago";
const DEFAULT_LOCALE = "en-US";

const INK = "#1F2933";
const MUTED = "#56636F";
/** The design system's `--orange`, for the one thing on an issue page that is a
 *  warning rather than content: the "this is a draft" banner. Not the accent —
 *  that is the school's, and an admin may set it to anything, including
 *  something that reads as ordinary chrome. */
const DEFAULT_ORANGE = "#FAAB1C";
/** The "volunteers needed" flag on an event row. A darkened `--orange` rather
 *  than DEFAULT_ORANGE itself, which is a fill colour and fails contrast as
 *  13px text on white; it matches the same flag on the calendar's agenda. Not
 *  the accent, deliberately — this is the one thing in an events block a reader
 *  is being ASKED something by, and it has to survive an accent set to orange. */
const VOLUNTEER = "#A06A00";
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

// ── Footer HTML ─────────────────────────────────────────────────────────────
//
// The newsletter footer is the one place an admin writes HTML by hand (a PTO
// board list, a sponsor logo row, a couple of styled links). Everything else in
// an issue is TipTap JSON, so this needs its own sanitizer — and it has to be a
// real one, because the footer is echoed onto the PUBLIC archive pages, where a
// surviving `<script>` would be stored XSS on the newsletter origin.
//
// Design, mirroring the document sanitizer above:
//   • Allowlisted tags only. An unknown-but-harmless tag (<section>, <font>) is
//     dropped while its CONTENTS are kept — strip-tag-keep-content, same as
//     sanitizeNode. An unknown-and-dangerous one (<script>, <iframe>, …) is
//     dropped WITH its contents, since its text is code, not prose.
//   • Allowlisted attributes only, re-emitted from parsed values rather than
//     copied through, so nothing rides along inside a mangled quote.
//   • Tags are balanced on the way out. An admin's unclosed <div> must not be
//     able to swallow the rest of the archive page.

/** Tags that carry no content and are emitted self-closed. */
const FOOTER_VOID_TAGS = new Set(["br", "hr", "img"]);

/** Tags dropped along with everything inside them: their content is script,
 *  style or markup we can't vouch for, so keeping the text would be wrong. */
const FOOTER_OPAQUE_TAGS = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet",
  "noscript", "template", "svg", "math", "head", "title", "textarea", "form",
  "input", "button", "select", "option", "link", "meta", "base",
]);

/** Attributes allowed on every allowed tag. */
const FOOTER_GLOBAL_ATTRS = new Set(["style", "title", "dir", "lang"]);

/** Allowed tags → the attributes each may carry beyond the global set. Email
 *  clients still lay out with presentational table attributes, so those stay. */
const FOOTER_TAGS: Record<string, string[]> = {
  p: ["align"],
  div: ["align"],
  span: [],
  a: ["href"],
  strong: [], b: [], em: [], i: [], u: [], s: [], small: [], sub: [], sup: [],
  br: [], hr: [],
  h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: ["start"], li: [],
  blockquote: [],
  img: ["src", "alt", "width", "height", "align"],
  table: ["width", "align", "border", "cellpadding", "cellspacing", "bgcolor"],
  thead: [], tbody: [], tfoot: [],
  tr: ["align", "valign", "bgcolor"],
  td: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor"],
  th: ["width", "height", "align", "valign", "colspan", "rowspan", "bgcolor"],
};

/** Longest footer we'll store. Well past any real footer; a bound on what one
 *  setting can inject into every email and every archive page. */
export const FOOTER_HTML_MAX = 20_000;

/** Matches one markup construct: a comment, a declaration/PI, or a tag whose
 *  attribute list may itself contain quoted `>` characters. */
const FOOTER_CONSTRUCT =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

const FOOTER_ATTR =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** CSS we refuse outright rather than try to rewrite: anything that fetches
 *  (`url()`, `@import` — a tracker or an exfil channel on a public page),
 *  anything historically executable (`expression()`, `behavior:`), and any
 *  attempt to escape the attribute. */
const UNSAFE_CSS = /(^|[^a-z-])(url\s*\(|expression\s*\(|@import|behaviou?r\s*:|javascript\s*:|-moz-binding)/i;

function safeStyle(raw: string): string | null {
  const css = raw.trim();
  if (!css || css.length > 500) return null;
  if (UNSAFE_CSS.test(css)) return null;
  // Real CSS in a footer needs none of these, and refusing them outright is a
  // property worth having: whatever ends up inside style="…" is then plain CSS
  // text, with no entity or quote left that could be re-parsed as markup.
  if (/["&<>\\]/.test(css)) return null;
  return css;
}

/** Presentational attributes are numbers, percentages or keywords — never
 *  arbitrary strings. Anything else is dropped rather than escaped through. */
function safePresentational(name: string, value: string): string | null {
  const v = value.trim();
  if (!v || v.length > 40) return null;
  if (name === "bgcolor") return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(v) ? v : null;
  if (name === "align" || name === "valign" || name === "dir" || name === "lang") {
    return /^[a-zA-Z-]+$/.test(v) ? v : null;
  }
  return /^\d+%?$/.test(v) ? v : null;
}

function footerAttrs(tag: string, rawAttrs: string): string {
  const allowed = FOOTER_TAGS[tag];
  if (!allowed) return "";
  const out: string[] = [];
  const seen = new Set<string>();
  FOOTER_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FOOTER_ATTR.exec(rawAttrs)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name || seen.has(name)) continue;
    if (!FOOTER_GLOBAL_ATTRS.has(name) && !allowed.includes(name)) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    seen.add(name);

    if (name === "href") {
      const href = safeLinkHref(value);
      if (href) out.push(`href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"`);
      continue;
    }
    if (name === "src") {
      const src = safeImageSrc(value);
      if (src) out.push(`src="${escapeHtml(src)}"`);
      continue;
    }
    if (name === "style") {
      const css = safeStyle(value);
      if (css) out.push(`style="${escapeHtml(css)}"`);
      continue;
    }
    if (name === "title" || name === "alt") {
      out.push(`${name}="${escapeHtml(value)}"`);
      continue;
    }
    const safe = safePresentational(name, value);
    if (safe) out.push(`${name}="${escapeHtml(safe)}"`);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

/** Text between tags. Entities are left alone (this is authored HTML, so
 *  `&amp;` means what it says), but a bare `<` that didn't parse as a tag is
 *  escaped so it can't become one downstream. */
function footerText(raw: string): string {
  return raw.replace(/</g, "&lt;");
}

/** Sanitize a hand-written footer to the allowlist above. Applied at write
 *  time, so what's stored is already safe to interpolate into the email and the
 *  public archive pages. Returns "" for anything that isn't usable HTML. */
export function sanitizeFooterHtml(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const input = raw.trim().slice(0, FOOTER_HTML_MAX);
  if (!input) return "";

  const out: string[] = [];
  const open: string[] = [];
  /** Non-empty while inside an opaque element; everything is discarded until
   *  its matching close tag. Nesting is counted so `<script><script>` can't end
   *  the skip early. */
  let opaque = "";
  let opaqueDepth = 0;
  let cursor = 0;

  FOOTER_CONSTRUCT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FOOTER_CONSTRUCT.exec(input)) !== null) {
    if (!opaque) out.push(footerText(input.slice(cursor, m.index)));
    cursor = m.index + m[0].length;

    const closing = m[1] === "/";
    const tag = m[2]?.toLowerCase();
    // A comment or declaration: no tag captured, nothing to emit.
    if (!tag) continue;

    if (opaque) {
      if (tag !== opaque) continue;
      if (closing) {
        opaqueDepth--;
        if (opaqueDepth === 0) opaque = "";
      } else if (!FOOTER_VOID_TAGS.has(tag)) {
        opaqueDepth++;
      }
      continue;
    }

    if (FOOTER_OPAQUE_TAGS.has(tag)) {
      // A stray closing tag has nothing to skip to; just drop it.
      if (!closing) {
        opaque = tag;
        opaqueDepth = 1;
      }
      continue;
    }

    // Unknown but harmless: drop the tag, keep what's inside it.
    if (!(tag in FOOTER_TAGS)) continue;

    if (FOOTER_VOID_TAGS.has(tag)) {
      if (!closing) out.push(`<${tag}${footerAttrs(tag, m[3] ?? "")} />`);
      continue;
    }

    if (closing) {
      const at = open.lastIndexOf(tag);
      // Unbalanced close: ignore it rather than closing something it didn't open.
      if (at < 0) continue;
      // Close everything the admin left open inside it, innermost first.
      for (let i = open.length - 1; i >= at; i--) out.push(`</${open[i]}>`);
      open.length = at;
      continue;
    }

    out.push(`<${tag}${footerAttrs(tag, m[3] ?? "")}>`);
    open.push(tag);
  }

  if (!opaque) out.push(footerText(input.slice(cursor)));
  for (let i = open.length - 1; i >= 0; i--) out.push(`</${open[i]}>`);

  return out.join("").trim();
}

/** The footer as HTML: the admin's markup, already sanitized on write. Kept as
 *  a helper rather than inlined so the email and the archive pages can't drift
 *  apart about what a footer is. */
export function footerHtmlOf(branding: NewsletterBrandingDTO): string {
  return branding.footerHtml;
}

/** The footer as plain text, for the email's text part. The footer is authored
 *  once, as HTML, so the text part is that markup flattened — there is no
 *  separate plain-text wording to prefer. */
export function footerTextOf(branding: NewsletterBrandingDTO): string {
  return htmlToText(branding.footerHtml);
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
    rangeStart: isoDateOrNull(a.rangeStart),
    rangeEnd: isoDateOrNull(a.rangeEnd),
    excluded: Array.isArray(a.excluded)
      ? a.excluded.filter((v): v is string => typeof v === "string")
      : [],
    heading: typeof a.heading === "string" && a.heading ? a.heading : null,
  };
}

/** A calendar date, or null for anything that isn't one. Shape-checked rather
 *  than trusted: these attrs come out of a stored document. */
function isoDateOrNull(raw: unknown): string | null {
  return typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
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
  /** Public calendar site, or "" to omit the "See all" link. */
  calendarUrl: string;
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
  // The resolver hands back the whole queried window; the author's removals are
  // applied here so the email, the archive page and both previews drop the same
  // events.
  const events = visibleEvents(attrs, ctx.resolve(attrs));
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
    // Still worth offering: a block that came up empty is exactly when a reader
    // wants somewhere else to look.
    parts.push(seeAllLink(ctx));
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
      // Linked when a calendar site is configured, plain otherwise — the same
      // rule "See all events" follows, so a deployment with no calendar host
      // renders exactly as it did before rather than emitting a dead link.
      // Accent-coloured rather than ink, matching that link, because an inbox
      // gives a reader no hover to discover clickability with.
      const href = eventHref(ctx, e);
      const title = escapeHtml(e.title);
      const titleHtml = href
        ? `<a href="${escapeHtml(href)}"${attr(ctx, "nl-event-title-link", `color:${ctx.accent};text-decoration:none`)}>${title}</a>`
        : title;
      return `<tr><td${attr(ctx, "nl-event", `padding:10px 0 10px 12px;border-left:3px solid ${escapeHtml(bar)};border-bottom:1px solid ${RULE}`)}>
<div${attr(ctx, "nl-event-title", `font-size:15px;font-weight:600;color:${INK};font-family:${FONT};line-height:1.4`)}>${titleHtml}</div>
<div${attr(ctx, "nl-event-meta", `font-size:13px;color:${MUTED};font-family:${FONT};margin-top:2px`)}>${escapeHtml(meta)}</div>${volunteerLine(ctx, e)}
</td></tr>`;
    })
    .join("");

  parts.push(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"${attr(ctx, "nl-events", "width:100%;border-collapse:collapse;margin:0 0 20px")}>${rows}</table>`,
  );
  parts.push(seeAllLink(ctx));
  return parts.join("");
}

/** Absolute URL of ONE event's page on the calendar site, or null when no
 *  calendar URL is configured (or it isn't a safe absolute one).
 *
 *  The path is a content identity — day plus title slug — not an id; see
 *  packages/shared/src/eventPath.ts for why an event has no durable public
 *  handle to link to. Two consequences are worth knowing here:
 *
 *   - The day is minted in the ISSUE'S zone, not a reader's, because there is no
 *     reader when an email is composed. `findEventByPath` searches a day either
 *     side, so a recipient in another zone still lands on the right event.
 *   - A link OUTLIVES what it points at. `calendar_event` keeps roughly two days
 *     of past events, so an archived issue's event links stop resolving shortly
 *     after the event happens, and the page answers with its "event not found"
 *     card and a way back to the calendar. That is the cost of an addressable
 *     event at all, and it degrades to what an unlinked title already offered.
 *
 *  Safe on the public archive page as well as in the email: an event page is
 *  ungated, like the agenda it was reached from.
 */
function eventHref(ctx: Ctx, e: EventPathInput): string | null {
  const base = safeLinkHref(ctx.calendarUrl);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}${eventPath(e, ctx.timeZone)}`;
}

/** The public page of ONE occurrence's volunteer sheet, or null when no calendar
 *  URL is configured.
 *
 *  `/v/:slug` rather than the event's own `/e/:date/:slug`, even though the sheet
 *  is RENDERED on the event page and that is where this link lands. The slug is
 *  the only DURABLE handle a sheet has (invariant 13); the event path is a
 *  content identity that a retitle invalidates (invariant 8, eventPath.ts). A
 *  newsletter is mailed once and archived forever, so the link that outlives a
 *  retitle is the right one to put in it — and `/v/:slug` resolving to the event
 *  page is exactly the forward that makes it safe to prefer.
 *
 *  Public on both surfaces this renders for: the sheet's anonymous route
 *  publishes counts and never names, which is the whole reason a sheet has a
 *  slug of its own. */
function volunteerHref(ctx: Ctx, slug: string): string | null {
  const base = safeLinkHref(ctx.calendarUrl);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/v/${encodeURIComponent(slug)}`;
}

/** "Volunteers needed", under an event that has a published sheet — otherwise
 *  the empty string, so a row without one renders exactly as it did before.
 *
 *  The signal is `volunteerSlug`, i.e. "this occurrence has a PUBLISHED sheet",
 *  which is the same thing the calendar's agenda flags and the same words it
 *  uses. It is deliberately not "has unfilled spots": that count is not in the
 *  DTO, and it could not be trusted here even if it were — an events block is
 *  frozen at send (invariant 10), so a live count would be a promise the email
 *  starts breaking the moment somebody signs up.
 *
 *  Unlinked when no calendar URL is configured, like the title and "See all
 *  events" — a deployment without a calendar host still says where help is
 *  wanted, it just can't say where to go. */
function volunteerLine(ctx: Ctx, e: CalendarEventDTO): string {
  if (!e.volunteerSlug) return "";
  const style = `font-size:13px;font-weight:700;color:${VOLUNTEER};font-family:${FONT};margin-top:3px`;
  const href = volunteerHref(ctx, e.volunteerSlug);
  // Colour stated on the anchor too: an inbox restyles a bare <a> blue, and this
  // one is a flag before it is a link.
  const inner = href
    ? `<a href="${escapeHtml(href)}"${attr(ctx, "nl-event-volunteer-link", `color:${VOLUNTEER};text-decoration:none`)}>Volunteers needed →</a>`
    : "Volunteers needed";
  return `\n<div${attr(ctx, "nl-event-volunteer", style)}>${inner}</div>`;
}

/** "See all" out to the public calendar site. Omitted entirely when no calendar
 *  URL was supplied, so a deployment that hasn't set one renders as before
 *  rather than emitting a dead link.
 *
 *  Safe on the public archive page as well as in the email: the calendar's home
 *  screen is deliberately ungated (it reads /calendar-public/*), so this points
 *  a reader at something they can actually open without signing in. */
function seeAllLink(ctx: Ctx): string {
  const href = safeLinkHref(ctx.calendarUrl);
  if (!href) return "";
  // Negative top margin tucks it under whatever it follows — the table and the
  // empty-state paragraph both carry their own bottom margin, and this reads as
  // part of the block rather than a new paragraph after it.
  return `<p${attr(ctx, "nl-events-more", `margin:-12px 0 20px;font-size:13.5px;font-family:${FONT}`)}><a href="${escapeHtml(href)}"${attr(ctx, "nl-events-more-link", `color:${ctx.accent};text-decoration:none;font-weight:600`)}>See all events →</a></p>`;
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
    calendarUrl: opts.calendarUrl ?? "",
  });
}

// ── Plain text ──────────────────────────────────────────────────────────────

/** Plain-text alternative for the email's `text` part. Also the basis for
 *  archive excerpts and OG descriptions. */
export function renderNewsletterText(
  doc: NewsletterNode,
  resolveEvents: EventsResolver,
  opts: Pick<NewsletterRenderOptions, "timeZone" | "locale" | "calendarUrl"> = {},
): string {
  const timeZone = opts.timeZone || DEFAULT_TIME_ZONE;
  const locale = opts.locale || DEFAULT_LOCALE;
  const calendarUrl = safeLinkHref(opts.calendarUrl);
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
        const events = visibleEvents(attrs, resolveEvents(attrs));
        if (events.length === 0) {
          out.push("No upcoming events.");
          // Plain text can't hyperlink, so the destination is spelled out — the
          // same convention link marks use above.
          if (calendarUrl) out.push(`See all events: ${calendarUrl}`);
          break;
        }
        for (const e of events) {
          const when = [formatEventDay(e, locale, timeZone), formatEventTime(e, locale, timeZone)]
            .filter(Boolean)
            .join(" · ");
          const line = `• ${e.title} — ${[when, e.location].filter(Boolean).join(" — ")}`;
          // Plain text can't hyperlink, so the event page's URL is spelled out
          // under its title — the same convention link marks and "See all" use.
          // On its own line rather than in parentheses: these are long, and a
          // reader scanning dates shouldn't have to read past one to reach the
          // next event.
          const href = calendarUrl
            ? `${calendarUrl.replace(/\/+$/, "")}${eventPath(e, timeZone)}`
            : null;
          // Same flag the HTML draws, and part of the SAME entry as the event:
          // `out` is joined with blank lines and each entry is trimmed, so a
          // push of its own would float the flag off as a paragraph belonging to
          // nothing. The URL is the sheet's own, for the reason volunteerHref
          // gives.
          const sheet =
            e.volunteerSlug && calendarUrl
              ? `${calendarUrl.replace(/\/+$/, "")}/v/${encodeURIComponent(e.volunteerSlug)}`
              : null;
          const flag = e.volunteerSlug
            ? `\n  Volunteers needed${sheet ? `: ${sheet}` : ""}`
            : "";
          out.push(`${line}${href ? `\n  ${href}` : ""}${flag}`);
        }
        if (calendarUrl) out.push(`See all events: ${calendarUrl}`);
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
    // Carried on branding rather than as its own email input: the archive page
    // renders from the same DTO, so both surfaces link to the same place.
    calendarUrl: input.branding.calendarUrl,
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
<div style="margin:16px 0 8px;font-size:12.5px;line-height:1.6;color:${MUTED};font-family:${FONT}">${footerHtmlOf(input.branding)}</div>
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
    calendarUrl: input.branding.calendarUrl,
  });
  return [
    input.title,
    input.subtitle ?? "",
    "",
    body,
    "",
    "—".repeat(24),
    `View in your browser: ${input.webUrl}`,
    footerTextOf(input.branding),
    input.mailingAddress,
    `${input.unsubscribeWording} ${input.unsubscribeUrl}`,
  ]
    .filter((s) => s !== "")
    .join("\n\n");
}

// ── The issue page ──────────────────────────────────────────────────────────

/** Date on an issue page, e.g. "August 15, 2026".
 *
 *  Fixed to English and UTC, matching what the archive already did inline. That
 *  is a deliberate difference from `formatEventDay`/`formatEventTime`, which ARE
 *  locale- and zone-parameterized: those name an instant a reader is expected to
 *  show up at, so getting the zone wrong moves an event a day. This names when
 *  an issue was sent or last touched — page furniture on surfaces that have no
 *  locale of their own (see functions/_lib/page.ts). It lives here so the
 *  archive, the review page and the admin's print view don't keep three copies. */
export function formatIssueDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface NewsletterIssuePageInput extends NewsletterWrapperInput {
  /** Already formatted by the caller — usually `formatIssueDate(sentAt)`, or a
   *  "last edited …" line for an issue that hasn't gone out. */
  dateLabel: string;
  /** Draws the "not sent yet" banner. Drives nothing else: an unsent issue and
   *  a sent one render identically otherwise, which is the point of showing a
   *  reviewer the real thing. */
  isDraft: boolean;
  /** Href for the masthead and the "See all issues" link, or "" to omit both —
   *  an issue reached by a review token has no archive entry to return to, and
   *  linking one would invite a reviewer to go looking for a page that 404s. */
  archiveHref: string;
  /** Href of the print view, or "" to omit the link (the print view itself
   *  passes "", so the printed page never carries a link to itself). */
  printHref: string;
}

/** The issue page body — masthead, title, date, rendered body, footer.
 *
 *  Extracted from what was inline markup in functions/n/[slug].ts so the public
 *  archive page, the review page, both of their print views and the admin's
 *  own print view render through ONE function instead of drifting into five
 *  near-identical templates. Emits the `.nl-` classes in NEWSLETTER_WEB_CSS
 *  below; the caller supplies the document around it. */
export function renderNewsletterIssuePageHtml(input: NewsletterIssuePageInput): string {
  const { branding } = input;
  const body = renderNewsletterBodyHtml(input.doc, input.resolveEvents, {
    mode: "web",
    accentColor: branding.accentColor,
    timeZone: input.timeZone,
    locale: input.locale,
    calendarUrl: branding.calendarUrl,
  });

  const mark = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${escapeHtml(branding.newsletterTitle)}</div>`;
  const masthead = input.archiveHref
    ? `<a href="${escapeHtml(input.archiveHref)}" style="text-decoration:none">${mark}</a>`
    : mark;

  // Said plainly, and above the content rather than below it: a reviewer who
  // was sent a link has no other way to tell a draft from the real thing, and
  // finding out after reading is finding out too late.
  const banner = input.isDraft
    ? `<div class="nl-draft-banner">Draft — not sent yet. This is a private preview link.</div>`
    : "";

  const foot = [
    footerHtmlOf(branding),
    input.archiveHref
      ? `<p style="margin:8px 0 0"><a href="${escapeHtml(input.archiveHref)}">See all issues</a></p>`
      : "",
    input.printHref
      ? `<p class="nl-print-link"><a href="${escapeHtml(input.printHref)}">View as PDF</a></p>`
      : "",
  ]
    .filter(Boolean)
    .join("\n          ");

  return `    <div class="nl-wrap">
      ${banner}
      <div class="nl-masthead">${masthead}</div>
      <article class="nl-card">
        <h1 class="nl-title">${escapeHtml(input.title)}</h1>
        ${input.subtitle ? `<p class="nl-subtitle">${escapeHtml(input.subtitle)}</p>` : ""}
        <p class="nl-date">${escapeHtml(input.dateLabel)}</p>
        <div class="nl-body">
${body}
        </div>
        <div class="nl-foot">
          ${foot}
        </div>
      </article>
    </div>`;
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
.nl-events-more{margin:-12px 0 20px;font-size:13.5px}
.nl-events-more-link{color:var(--nl-accent,${DEFAULT_ACCENT});text-decoration:none;font-weight:600}
.nl-events-more-link:hover{text-decoration:underline}
.nl-event{padding:10px 0 10px 12px;border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT});border-bottom:1px solid ${RULE}}
.nl-event-title{font-size:15px;font-weight:600;line-height:1.4}
.nl-event-title-link{color:var(--nl-accent,${DEFAULT_ACCENT});text-decoration:none}
.nl-event-title-link:hover{text-decoration:underline}
.nl-event-meta{font-size:13px;color:${MUTED};margin-top:2px}
.nl-event-volunteer{font-size:13px;font-weight:700;color:${VOLUNTEER};margin-top:3px}
.nl-event-volunteer-link{color:${VOLUNTEER};text-decoration:none}
.nl-event-volunteer-link:hover{text-decoration:underline}
.nl-foot{margin-top:22px;padding-top:18px;border-top:1px solid ${RULE};font-size:13px;line-height:1.6;color:${MUTED}}
.nl-archive-item{display:block;background:${PAPER};border-radius:12px;padding:18px 20px;margin-bottom:12px;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(16,24,40,.06)}
.nl-archive-item h2{margin:0;font-size:19px;line-height:1.3}
.nl-archive-item p{margin:6px 0 0;font-size:14.5px;line-height:1.55;color:${MUTED}}
.nl-archive-date{display:block;font-size:12.5px;color:${MUTED};margin-bottom:4px}
.nl-empty{background:${PAPER};border-radius:12px;padding:40px 20px;text-align:center;color:${MUTED}}
.nl-site-foot{max-width:680px;margin:0 auto;padding:0 16px 40px;text-align:center;font-size:13px;color:${MUTED}}
.nl-subscribe-cta{display:block;background:${PAPER};border-radius:12px;padding:16px 20px;margin-bottom:18px;text-decoration:none;color:inherit;box-shadow:0 1px 3px rgba(16,24,40,.06);border-left:3px solid var(--nl-accent,${DEFAULT_ACCENT})}
.nl-subscribe-cta strong{color:var(--nl-accent,${DEFAULT_ACCENT})}
.nl-subscribe-cta span{display:block;margin-top:3px;font-size:14px;color:${MUTED}}
.nl-form{margin:22px 0 0}
.nl-label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
.nl-input{width:100%;font:inherit;font-size:16px;padding:11px 13px;border:1px solid ${RULE};border-radius:9px;background:${PAPER};color:inherit}
.nl-input:focus{outline:2px solid var(--nl-accent,${DEFAULT_ACCENT});outline-offset:1px;border-color:transparent}
.nl-btn{display:inline-block;margin-top:14px;font:inherit;font-size:16px;font-weight:600;padding:11px 20px;border:0;border-radius:9px;background:var(--nl-accent,${DEFAULT_ACCENT});color:#fff;cursor:pointer;text-decoration:none}
.nl-btn:hover{filter:brightness(.93)}
.nl-hint{margin:12px 0 0;font-size:13.5px;line-height:1.6;color:${MUTED}}
.nl-error{margin:0 0 14px;padding:11px 14px;border-radius:9px;background:#fdecec;color:#8a1c1c;font-size:14.5px}
/* Off-screen rather than display:none — a bot reading the DOM sees a normal
   field, while a screen reader is told to skip it. */
.nl-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
@media (max-width:520px){.nl-card{padding:22px 18px 26px}.nl-title{font-size:25px}}
.nl-print-link{margin:8px 0 0}
.nl-draft-banner{
  margin:0 0 16px;padding:10px 14px;border-radius:9px;
  background:#fff4d6;border-left:3px solid ${DEFAULT_ORANGE};
  font-size:13.5px;line-height:1.5;color:#6b4d05;
}

/* Printing IS the PDF export — there is no PDF renderer in this project, and a
   second one would be a second place for a newsletter's look to drift from the
   email (invariant 9). So the print stylesheet is part of the one stylesheet,
   which also means an ordinary Ctrl+P on any issue page comes out clean; the
   dedicated /print routes add only the auto-firing dialog.

   Everything hidden here is navigation or an affordance that means nothing on
   paper. The draft banner deliberately SURVIVES: a printed draft handed round a
   meeting table is exactly where "this went out already" is easiest to assume
   and most expensive to get wrong. */
@media print{
  body{background:#fff}
  .nl-site-foot,.nl-subscribe-cta,.nl-print-link,.nl-events-more{display:none}
  .nl-wrap{max-width:none;padding:0}
  .nl-card{box-shadow:none;border-radius:0;padding:0}
  .nl-masthead{padding:0 0 14px}
  /* Links keep their href meaning on screen but read as noise in ink. */
  a{color:inherit;text-decoration:none}
  .nl-title{font-size:26px}
  .nl-p,.nl-ul,.nl-ol{font-size:12pt;line-height:1.55}
  /* Don't strand a heading or an event row at the foot of a page. */
  .nl-h1,.nl-h2,.nl-h3,.nl-events-heading{break-after:avoid;page-break-after:avoid}
  .nl-event,.nl-li,.nl-img,.nl-quote{break-inside:avoid;page-break-inside:avoid}
  /* Nothing on paper is clickable, so an accent-coloured title is just noise. */
  .nl-event-title-link{color:${INK}}
  .nl-foot{break-inside:avoid}
}
`.trim();
