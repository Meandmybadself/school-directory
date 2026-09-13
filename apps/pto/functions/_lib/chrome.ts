// The header and footer the public PTO page wears.
//
// Kept out of page.ts so that file stays about the document (head, meta,
// caching) and this one about what a reader sees — the same split
// apps/store/functions/_lib/chrome.ts makes. Both are plain strings: no
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
import { LANG_PARAM } from "./locale.js";
import { escapeHtml } from "./page.js";

export const APEX_URL = "https://eisenhower.school";
export const DIRECTORY_URL = "https://directory.eisenhower.school";
export const CALENDAR_URL = "https://calendar.eisenhower.school";
export const NEWSLETTER_URL = "https://newsletter.eisenhower.school";
export const STORE_URL = "https://store.eisenhower.school";
export const FEEDBACK_EMAIL = "admin@eisenhower.school";

/** The sibling apps the header links to, in the order `PLATFORM_APPS` fixes
 *  for every surface in the project. Hardcoded production origins, like the
 *  rest of this file: a Pages Function has no `import.meta.env`. This page IS
 *  the PTO, so its own entry is relative and rendered as current. */
const PLATFORM_ORIGINS: PlatformOrigins = {
  directory: DIRECTORY_URL,
  calendar: CALENDAR_URL,
  newsletter: NEWSLETTER_URL,
  pto: "",
};

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

/** A link into a sibling app, carrying the reader's language with it.
 *
 *  `?lang=` is the deep-link parameter every SPA honours: it applies the
 *  language, remembers it the way the picker would, and strips the parameter
 *  from the address bar. So a parent reading this page in Somali lands in the
 *  calendar in Somali without opening a setting. */
export function appHref(base: string, path: string, locale: Locale): string {
  return `${base.replace(/\/$/, "")}${path}?${LANG_PARAM}=${locale}`;
}

/** The language switcher's links: each language's name written in that language,
 *  the current one bolded rather than linked. Emits NO copy of its own, the same
 *  choice the footer and apps/home's hero make (see the footer comment below).
 *  The links carry `?lang=` and KEEP it — a stable per-language URL is what the
 *  hreflang alternates point at and what sharing this page in one language needs.
 *  Shared by the footer and the header so the two can't drift. */
function langLinks(path: string, locale: Locale): string {
  return LOCALES.map((l) => {
    const href = `${path}?${LANG_PARAM}=${l}`;
    const name = escapeHtml(localeNames[l].native);
    return l === locale
      ? `<strong lang="${l}">${name}</strong>`
      : `<a lang="${l}" href="${escapeHtml(href)}">${name}</a>`;
  }).join("");
}

/** The header, and the nav that is one link shorter than it looks.
 *
 *  THERE IS NO STORE LINK while the shop is being built — the same rule
 *  apps/home's tile grid follows, for the same reason: nothing on this site
 *  sends anybody to an unannounced shop, so the two are restored together.
 *  `STORE_URL` above and the `navStore` string stay where they are, already
 *  translated, waiting for that day. The vanity redirect at
 *  eisenhower.school/store still resolves, since typing a path is not the same
 *  as being sent down it.
 *
 *  Said here rather than in an HTML comment: this page is indexed, and a note
 *  in the markup would announce the unannounced shop to anyone reading source. */
export function header(
  t: (key: keyof Strings) => string,
  school: string,
  locale: Locale,
  path: string,
): string {
  // The same four, in the same order, as every SPA's switcher and the store's
  // header. A reader here is signed out, so each lands on a PUBLIC entry.
  const links = PLATFORM_APPS.map((app) => {
    const href = escapeHtml(platformAppHref(app, PLATFORM_ORIGINS, locale, false));
    const current = app.key === "pto" ? ' aria-current="page"' : "";
    return `<a href="${href}"${current}>${escapeHtml(t(app.label))}</a>`;
  }).join("\n        ");
  return `    <header class="pt-head">
      <a class="pt-brand" href="/">
        <span class="pt-mark">${escapeHtml(school.slice(0, 1) || "E")}</span>
        <span>
          <span class="pt-brand-name">${escapeHtml(school)}</span><br />
          <span class="pt-brand-sub">${escapeHtml(t("brandSubPto"))}</span>
        </span>
      </a>
      <nav class="pt-navlinks">
        ${links}
      </nav>
      <!-- The footer carries the language switcher on wide screens; on a phone
           that is a long scroll away, so the same links ride in the header,
           shown only at mobile widths (styles: .pt-head-langs). -->
      <div class="pt-langs pt-head-langs">${langLinks(path, locale)}</div>
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
export function footer(
  t: (key: keyof Strings, vars?: Record<string, string>) => string,
  path: string,
  locale: Locale,
): string {
  return `    <footer class="pt-foot">
      <div>${credit(t)}</div>
      <div class="pt-langs">${langLinks(path, locale)}</div>
      <div style="margin-top:10px"><a href="/app">Board members: sign in</a></div>
    </footer>`;
}
