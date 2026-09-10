// The document chrome every page on this hostname shares: the `<head>`, the
// header with its way-out link, the footer, and the small helpers that put a
// value inside a translated sentence.
//
// It exists because there are now TWO pages here — the landing page and
// `/faq` — and the header, footer and `<head>` are the same object on both. The
// five SPAs copy their design system on purpose and are expected to drift; two
// routes inside one Worker have no such excuse, so this is imported, not
// copied. Anything genuinely specific to one page stays in that page's file.

import {
  LOCALES,
  SOURCE_URL,
  dictionaries,
  interpolate,
  localeNames,
  type Locale,
  type Strings,
} from "@sd/shared";
import type { Env } from "./env.js";
import { STYLES } from "./styles.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sentinel interpolated in place of a value that has to be wrapped in markup,
 *  then split on. It keeps the value wherever the TRANSLATOR put it in the
 *  sentence instead of assuming every language orders it the way English does.
 *  A NUL can never appear in a dictionary string, so the split is unambiguous. */
export const SLOT = "\u0000";

/** The two halves of a sentence, either side of the slot. */
export function splitSlot(template: string, key: string): [string, string] {
  const [before = "", after = ""] = interpolate(template, { [key]: SLOT }).split(SLOT);
  return [before, after];
}

/** Interpolate a value into a sentence and wrap it in `<b>`, escaping both
 *  halves of the sentence and the value itself. */
export function emphasize(template: string, value: string): string {
  const [before, after] = splitSlot(template, "feature");
  return `${escapeHtml(before)}<b>${escapeHtml(value)}</b>${escapeHtml(after)}`;
}

/** Same trick, but the slot becomes a link out — used to name whoever published
 *  a fact and hand the reader their site in the same breath. */
export function linkSlot(template: string, key: string, label: string, href: string): string {
  const [before, after] = splitSlot(template, key);
  return `${escapeHtml(before)}<a href="${escapeHtml(href)}">${escapeHtml(
    label,
  )}</a>${escapeHtml(after)}`;
}

/** A link into one of the apps, carrying the reader's language with it.
 *
 *  `?lang=` is the deep-link parameter every SPA already honours: it applies
 *  the language, remembers it the way the picker would, and strips the
 *  parameter from the address bar. So a parent who picked Somali here lands in
 *  the directory in Somali without ever opening a setting. */
export function appHref(base: string, path: string, locale: Locale): string {
  return `${base.replace(/\/$/, "")}${path}?lang=${locale}`;
}

/** Same-origin link that re-renders a page on THIS host in another language.
 *
 *  Unlike the SPAs, the parameter stays in the URL: there is no client here to
 *  remember a choice, and a stable per-language URL is what `hreflang` and a
 *  shared link both need. The `path` argument is what lets `/faq` switch
 *  language without bouncing the reader back to the front door — a picker that
 *  loses your place is a picker people stop using. */
export function langHref(locale: Locale, path = "/"): string {
  return `${path}?lang=${locale}`;
}

/** Per-language `<link rel="alternate">` set for one path, plus the x-default
 *  that points at the un-parameterised URL. */
export function alternatesFor(origin: string, path: string): string {
  return [
    ...LOCALES.map(
      (l) =>
        `<link rel="alternate" hreflang="${l}" href="${escapeHtml(
          origin + langHref(l, path),
        )}" />`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(origin + path)}" />`,
  ].join("\n    ");
}

export const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<rect width="64" height="64" rx="14" fill="#0068a8"/>' +
      '<path d="M22 17h21.4v7.6H30.4v7.1h11.4v7.3H30.4v7.4h13.4V54H22z" fill="#fff"/>' +
      "</svg>",
  );

/** Map pin for the hero's place-stamp. Inline because this Worker ships no
 *  asset of any kind, and `aria-hidden` because the place name beside it
 *  already says what it means in every language. */
export const PIN =
  '<svg class="place-pin" width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>' +
  '<circle cx="12" cy="10" r="3"/></svg>';

const FONTS =
  "https://fonts.googleapis.com/css2" +
  "?family=Hanken+Grotesk:wght@400;600;700;800" +
  "&family=Noto+Sans+SC:wght@400;700" +
  "&family=Spline+Sans+Mono:wght@400;600" +
  "&display=swap";

/** The bar at the top of every page here. It carries the way-out link to the
 *  district, because people still arrive on this domain looking for the
 *  school's own site — that is where it took them for years. */
export function siteHeader(env: Env, locale: Locale, s: Strings): string {
  return `
    <header class="hd">
      <div class="wrap hd-in">
        <a class="mark" href="${langHref(locale)}">${escapeHtml(s.brand)}<i>.school</i></a>
        <div class="hd-out">
          <span class="lbl">${escapeHtml(s.landingSchoolSiteLabel)}</span>
          <a href="${escapeHtml(env.SCHOOL_SITE_URL)}">${escapeHtml(s.landingSchoolSiteLink)}</a>
        </div>
      </div>
    </header>`;
}

/** Three items, deliberately: the PTO, an address to write to, and the source.
 *  Adding a fourth is a decision, not a convenience. */
export function siteFooter(env: Env, locale: Locale, s: Strings): string {
  const [feedBefore, feedAfter] = splitSlot(s.footerFeedback, "email");
  return `
    <footer class="ft">
      <div class="wrap ft-in">
        <div>
          <a href="${escapeHtml(appHref(env.PTO_URL, "/", locale))}">${escapeHtml(
            env.SCHOOL_NAME,
          )}</a>
          <span aria-hidden="true"> · </span>
          ${escapeHtml(feedBefore)}<a href="mailto:${escapeHtml(
            env.FEEDBACK_EMAIL,
          )}">${escapeHtml(env.FEEDBACK_EMAIL)}</a>${escapeHtml(feedAfter)}
          <span aria-hidden="true"> · </span>
          <a href="${escapeHtml(SOURCE_URL)}">GitHub</a>
        </div>
      </div>
    </footer>`;
}

/** The compact language picker, for pages whose hero is not itself one.
 *
 *  Its links are the language NAMES from `localeNames`, each written in its own
 *  language, and it emits no label of its own — the same shape, for the same
 *  reason, as the newsletter's translation bar (invariant 23): an English label
 *  like "Choose your language" is legible only to the readers who least need
 *  it. Adding a locale to `LOCALES` adds a link here for free.
 *
 *  `localeNames` is read across dictionaries rather than within one, which is
 *  the same deliberate exception the landing hero's greeting stack makes. */
export function langBar(locale: Locale, path: string): string {
  const items = LOCALES.map((l) => {
    // The name in ITS OWN language, never translated into the current one: a
    // Somali reader scanning for "Soomaali" will not find "Somali". Read from
    // `localeNames` rather than a table of our own, so this picker and the
    // landing hero's greeting stack cannot disagree about what a language is
    // called.
    const name = escapeHtml(localeNames[l].native);
    return l === locale
      ? `<li><strong lang="${l}" aria-current="true">${name}</strong></li>`
      : `<li><a lang="${l}" hreflang="${l}" href="${escapeHtml(
          langHref(l, path),
        )}" aria-label="${escapeHtml(
          interpolate(dictionaries[l].landingReadIn, { language: localeNames[l].native }),
        )}">${name}</a></li>`;
  }).join("");
  return `<ul class="langbar">${items}</ul>`;
}

export interface DocumentInput {
  lang: Locale;
  title: string;
  description: string;
  canonical: string;
  /** Pre-escaped markup for the end of `<head>`. */
  head: string;
  /** Pre-escaped markup for `<body>`. */
  body: string;
}

export function document(input: DocumentInput): string {
  const desc = input.description
    ? `<meta name="description" content="${escapeHtml(input.description)}" />
    <meta property="og:description" content="${escapeHtml(input.description)}" />`
    : "";
  return `<!doctype html>
<html lang="${input.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#0f151b" media="(prefers-color-scheme: dark)" />
    <title>${escapeHtml(input.title)}</title>
    ${desc}
    <link rel="canonical" href="${escapeHtml(input.canonical)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(input.title)}" />
    <meta property="og:url" content="${escapeHtml(input.canonical)}" />
    <meta property="og:locale" content="${input.lang}" />
    <meta name="twitter:card" content="summary" />
    <link rel="icon" href="${FAVICON}" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${FONTS}" />
    ${input.head}
    <style>${STYLES}</style>
  </head>
  <body>
${input.body}
  </body>
</html>`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
