// Which of our four languages this visitor reads.
//
// Three inputs, in priority order:
//
//   1. an explicit `?lang=` — the same one-shot deep link every SPA honours
//      (see LOCALE_PARAM in @sd/shared), and the most recent statement of what
//      this person reads;
//   2. the `sd_lang` cookie, which is a choice made HERE on an earlier visit;
//   3. the browser's Accept-Language header, which is the reader's OS/browser
//      setting rather than anything they said to us.
//
// The order is the point: a choice, once made, must not be quietly undone by
// detection. It is the server-side twin of `detectLocale` in each SPA's
// `src/i18n/index.tsx`, which reads `?lang=` → localStorage → navigator.language
// for exactly the same reason. This page can't use localStorage — it ships no
// client bundle — so the cookie is what stands in for it.
//
// The cookie is written only where an explicit `?lang=` was honoured, never
// from the header, so a detected language never becomes a remembered one.

import { LOCALES, localeFromSearch, localeFromTag, type Locale } from "@sd/shared";

/** Host-only, so it stays on the apex and never rides along to the API the way
 *  a `Domain`-scoped cookie would. The SPAs don't read it — outbound links
 *  carry `?lang=`, and each app saves the choice its own way. */
export const LANG_COOKIE = "sd_lang";

/** A year. Long enough that a family who picked Somali in September is still
 *  reading Somali in May, which is the whole point of remembering it. */
const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The first of our locales that an Accept-Language header asks for, honouring
 *  q-weights, or null if it asks for none of them.
 *
 *  `Accept-Language: so;q=0.8, en;q=0.9` must resolve to English, so the tags
 *  are sorted by weight before being matched — taking them in header order
 *  would answer Somali. A malformed q is treated as 0 rather than thrown, since
 *  this runs on every request and a bad header shouldn't cost a 500. */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.split(";").map((s) => s.trim());
      const q = params.find((p) => p.startsWith("q="));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      // `i` breaks ties in header order, which is the order of preference.
      return { tag, weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i);

  for (const { tag } of ranked) {
    if (tag === "*") return null;
    const locale = localeFromTag(tag);
    if (locale) return locale;
  }
  return null;
}

/** The remembered choice, or null. Anything we didn't write — a stale value
 *  from a retired locale, a hand-edited cookie — is simply not one of ours and
 *  falls through to detection. */
export function localeFromCookie(header: string | null): Locale | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== LANG_COOKIE) continue;
    return localeFromTag(decodeURIComponent(pair.slice(eq + 1).trim()));
  }
  return null;
}

export interface Resolved {
  locale: Locale;
  /** True when `?lang=` named it, rather than the cookie, the header or the
   *  fallback. Only an explicit choice is worth putting in the canonical URL —
   *  and it is also the only thing worth remembering. */
  explicit: boolean;
}

export function resolveLocale(url: URL, request: Request): Resolved {
  const asked = localeFromSearch(url.search);
  if (asked) return { locale: asked, explicit: true };
  const remembered = localeFromCookie(request.headers.get("cookie"));
  if (remembered) return { locale: remembered, explicit: false };
  const accepted = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return { locale: accepted ?? "en", explicit: false };
}

/** The `Set-Cookie` value that remembers an explicit choice.
 *
 *  `HttpOnly` because nothing on this page runs JavaScript, and `Lax` because
 *  the cookie only ever has to survive someone following a link back here. */
export function langCookie(locale: Locale): string {
  return [
    `${LANG_COOKIE}=${locale}`,
    "Path=/",
    `Max-Age=${LANG_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
    "Secure",
    "HttpOnly",
  ].join("; ");
}

export { LOCALES };
