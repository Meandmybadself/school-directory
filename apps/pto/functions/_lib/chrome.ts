// The header and footer the public PTO page wears.
//
// Kept out of page.ts so that file stays about the document (head, meta,
// caching) and this one about what a reader sees — the same split
// apps/store/functions/_lib/chrome.ts makes. Both are plain strings: no
// components, no bundle, nothing to hydrate.

import { LOCALES, SOURCE_URL, localeNames, type Locale, type Strings } from "@sd/shared";
import { LANG_PARAM } from "./locale.js";
import { escapeHtml } from "./page.js";

export const APEX_URL = "https://eisenhower.school";
export const DIRECTORY_URL = "https://directory.eisenhower.school";
export const CALENDAR_URL = "https://calendar.eisenhower.school";
export const NEWSLETTER_URL = "https://newsletter.eisenhower.school";
export const STORE_URL = "https://store.eisenhower.school";
export const FEEDBACK_EMAIL = "admin@eisenhower.school";

/** A link into a sibling app, carrying the reader's language with it.
 *
 *  `?lang=` is the deep-link parameter every SPA honours: it applies the
 *  language, remembers it the way the picker would, and strips the parameter
 *  from the address bar. So a parent reading this page in Somali lands in the
 *  calendar in Somali without opening a setting. */
export function appHref(base: string, path: string, locale: Locale): string {
  return `${base.replace(/\/$/, "")}${path}?${LANG_PARAM}=${locale}`;
}

export function header(t: (key: keyof Strings) => string, school: string, locale: Locale): string {
  return `    <header class="pt-head">
      <a class="pt-brand" href="/">
        <span class="pt-mark">${escapeHtml(school.slice(0, 1) || "E")}</span>
        <span>
          <span class="pt-brand-name">${escapeHtml(school)}</span><br />
          <span class="pt-brand-sub">${escapeHtml(t("brandSubPto"))}</span>
        </span>
      </a>
      <nav class="pt-navlinks">
        <a href="${escapeHtml(appHref(CALENDAR_URL, "/", locale))}">${escapeHtml(t("navCalendar"))}</a>
        <a href="${escapeHtml(appHref(NEWSLETTER_URL, "/", locale))}">${escapeHtml(t("navNewsletter"))}</a>
        <a href="${escapeHtml(appHref(STORE_URL, "/", locale))}">${escapeHtml(t("navStore"))}</a>
        <a href="${escapeHtml(appHref(DIRECTORY_URL, "/", locale))}">${escapeHtml(t("navDir"))}</a>
      </nav>
    </header>`;
}

/**
 * The footer, including the language switcher.
 *
 * The switcher emits NO copy of its own — just each language's name, written in
 * that language. That is the choice apps/store's footer and the newsletter's
 * translation bar both make, for the same reason: an English label like "Choose
 * your language" is legible only to the readers who least need it. Adding a
 * locale to LOCALES adds a link here for free.
 *
 * The links carry `?lang=` and KEEP it, unlike the SPAs which apply and strip
 * it: a stable per-language URL is what the hreflang alternates in page.ts point
 * at, and what somebody sharing this page in their own language needs.
 */
export function footer(path: string, locale: Locale): string {
  const langs = LOCALES.map((l) => {
    const href = `${path}?${LANG_PARAM}=${l}`;
    const name = escapeHtml(localeNames[l].native);
    return l === locale
      ? `<strong lang="${l}">${name}</strong>`
      : `<a lang="${l}" href="${escapeHtml(href)}">${name}</a>`;
  }).join("");

  return `    <footer class="pt-foot">
      <div>Eisenhower PTO · <a href="${APEX_URL}">eisenhower.school</a></div>
      <div>Email <a href="mailto:${FEEDBACK_EMAIL}">${FEEDBACK_EMAIL}</a></div>
      <div><a href="${SOURCE_URL}">View the source on GitHub</a></div>
      <div class="pt-langs">${langs}</div>
      <div style="margin-top:10px"><a href="/app">Board members: sign in</a></div>
    </footer>`;
}
