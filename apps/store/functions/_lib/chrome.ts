// The header and footer every server-rendered store page wears.
//
// Kept out of page.ts so that file stays about the document (head, meta,
// caching) and this one about what a reader sees. Both are plain strings — no
// components, no bundle, nothing to hydrate.

import { LOCALES, localeNames, PTO_URL, SOURCE_URL, type Locale, type Strings } from "@sd/shared";
import { escapeHtml } from "./page.js";
import { LANG_PARAM } from "./locale.js";

export const DIRECTORY_URL = "https://directory.eisenhower.school";
export const CALENDAR_URL = "https://calendar.eisenhower.school";
export const APEX_URL = "https://eisenhower.school";

export function header(t: (key: keyof Strings) => string, school: string): string {
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
        <a href="${CALENDAR_URL}">${escapeHtml(t("navCalendar"))}</a>
        <a href="${DIRECTORY_URL}">${escapeHtml(t("navDir"))}</a>
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
export function footer(path: string, locale: Locale): string {
  const langs = LOCALES.map((l) => {
    const href = `${path}?${LANG_PARAM}=${l}`;
    const name = escapeHtml(localeNames[l].native);
    return l === locale
      ? `<strong lang="${l}">${name}</strong>`
      : `<a lang="${l}" href="${escapeHtml(href)}">${name}</a>`;
  }).join("");

  return `    <footer class="st-foot">
      <div><a href="${PTO_URL}">Eisenhower PTO</a> · <a href="${APEX_URL}">eisenhower.school</a></div>
      <div>Questions? Email <a href="mailto:admin@eisenhower.school">admin@eisenhower.school</a></div>
      <div><a href="${SOURCE_URL}">View the source on GitHub</a></div>
      <div class="st-langs">${langs}</div>
      <div style="margin-top:10px"><a href="/app">Members: sign in</a></div>
    </footer>`;
}
