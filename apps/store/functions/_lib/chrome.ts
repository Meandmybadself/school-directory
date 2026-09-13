// The header and footer every server-rendered store page wears.
//
// Kept out of page.ts so that file stays about the document (head, meta,
// caching) and this one about what a reader sees. Both are plain strings — no
// components, no bundle, nothing to hydrate.

import {
  LOCALES,
  PLATFORM_APPS,
  PTO_URL,
  SOURCE_URL,
  localeNames,
  platformAppHref,
  type Locale,
  type PlatformOrigins,
  type Strings,
} from "@sd/shared";
import { escapeHtml } from "./page.js";
import { LANG_PARAM } from "./locale.js";

export const DIRECTORY_URL = "https://directory.eisenhower.school";
export const CALENDAR_URL = "https://calendar.eisenhower.school";
export const NEWSLETTER_URL = "https://newsletter.eisenhower.school";
export const APEX_URL = "https://eisenhower.school";

/** The sibling apps the header links to, in the order `PLATFORM_APPS` fixes
 *  for every surface in the project. Hardcoded production origins, like the
 *  rest of this file: a Pages Function has no `import.meta.env`. */
const PLATFORM_ORIGINS: PlatformOrigins = {
  directory: DIRECTORY_URL,
  calendar: CALENDAR_URL,
  newsletter: NEWSLETTER_URL,
  pto: PTO_URL,
};

/** Where feedback goes. One constant, used by the credit line below. */
export const FEEDBACK_EMAIL = "admin@eisenhower.school";

/** The organisation's name. A proper noun, so it is data and reads the same in
 *  all four languages. */
const SCHOOL_NAME = "Eisenhower PTO";

/** Sentinel interpolated in place of the address, then split on — the same
 *  trick the SPAs' SiteFooter uses. The address must be a `mailto:` link, so
 *  the phrase can't simply be interpolated and printed, and splitting keeps the
 *  address wherever the TRANSLATOR put it rather than where English puts it. */
const SLOT = "\u0000";

/** The credit line: whose site this is, where feedback goes, where the source
 *  is. THREE ITEMS, one line, and the same three on every surface in this
 *  project — the five SPAs' `SiteFooter`, apps/home, and the newsletter's
 *  server-rendered twin. Translated here, unlike that last one, because these
 *  pages already resolve a locale for their hreflang alternates. */
function credit(t: (key: keyof Strings, vars?: Record<string, string>) => string): string {
  const [before = "", after = ""] = t("footerFeedback", { email: SLOT }).split(SLOT);
  return [
    `<a href="${PTO_URL}">${escapeHtml(SCHOOL_NAME)}</a>`,
    `${escapeHtml(before)}<a href="mailto:${FEEDBACK_EMAIL}">${escapeHtml(
      FEEDBACK_EMAIL,
    )}</a>${escapeHtml(after)}`,
    `<a href="${SOURCE_URL}">GitHub</a>`,
  ].join('<span aria-hidden="true"> · </span>');
}

/** The header. Its nav is the cart, then the same four sibling apps in the
 *  same order as every SPA's switcher and the PTO's public page — a reader
 *  signed out, so each link lands on that app's PUBLIC entry. */
export function header(t: (key: keyof Strings) => string, school: string, locale: Locale): string {
  const links = PLATFORM_APPS.map(
    (app) =>
      `<a href="${escapeHtml(platformAppHref(app, PLATFORM_ORIGINS, locale, false))}">${escapeHtml(t(app.label))}</a>`,
  ).join("\n        ");
  return `    <header class="st-head">
      <a class="st-brand" href="/">
        <span class="st-mark">${escapeHtml(school.slice(0, 1) || "E")}</span>
        <span>
          <span class="st-brand-name">${escapeHtml(school)}</span><br />
          <span class="st-brand-sub">${escapeHtml(t("brandSubStore"))}</span>
        </span>
      </a>
      <nav class="st-navlinks">
        <a href="/cart">${escapeHtml(t("storeCart"))}</a>
        ${links}
      </nav>
    </header>`;
}

/**
 * The footer, including the language switcher.
 *
 * The switcher emits NO copy of its own — just each language's name, written in
 * that language. That is the same choice the newsletter's translation bar makes,
 * for the same reason: an English label like "Choose your language" is legible
 * only to the readers who least need it, and this is the one surface in the
 * project aimed at people who may not read English at all. Adding a locale to
 * LOCALES adds a link here for free.
 *
 * The links carry `?lang=` and keep it, unlike the SPAs which apply and strip
 * it: a stable per-language URL is what the hreflang alternates in page.ts point
 * at, and what somebody sharing a link in their own language needs to work.
 */
export function footer(
  t: (key: keyof Strings, vars?: Record<string, string>) => string,
  path: string,
  locale: Locale,
): string {
  const langs = LOCALES.map((l) => {
    const href = `${path}?${LANG_PARAM}=${l}`;
    const name = escapeHtml(localeNames[l].native);
    return l === locale
      ? `<strong lang="${l}">${name}</strong>`
      : `<a lang="${l}" href="${escapeHtml(href)}">${name}</a>`;
  }).join("");

  return `    <footer class="st-foot">
      <div>${credit(t)}</div>
      <div class="st-langs">${langs}</div>
      <div style="margin-top:10px"><a href="/app">Members: sign in</a></div>
    </footer>`;
}
