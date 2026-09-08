// Which of our four languages this shopper reads.
//
// A near-verbatim port of apps/home/src/locale.ts, and it is here for the same
// reason it is there: this is an INDEXED surface. The three members-only SPAs
// resolve language in the browser, which is fine when a crawler was never going
// to see the page. A page that advertises `hreflang` alternates has to actually
// serve them, before any client runs.
//
// Three inputs, in priority order:
//
//   1. an explicit `?lang=` — the same one-shot deep link every SPA honours,
//      and the most recent statement of what this person reads;
//   2. the `sd_lang` cookie, a choice made on an earlier visit;
//   3. Accept-Language, the browser's setting rather than anything they said.
//
// The order is the point: a choice, once made, must not be quietly undone by
// detection. The cookie is written ONLY where an explicit `?lang=` was honoured,
// so a detected language never promotes itself into a remembered preference.
//
// One difference from apps/home, and it matters: `?lang=` STAYS in the URL there
// because a stable per-language URL is what hreflang and a shared link both
// need. The same is true here, so it stays here too — unlike the SPAs, which
// apply it and strip it.

import { LOCALES, LOCALE_PARAM, localeFromSearch, localeFromTag, type Locale } from "@sd/shared";

export const LANG_PARAM = LOCALE_PARAM;

/** Host-only, so it stays on this origin and never rides along to the API the
 *  way a `Domain`-scoped cookie would. Same name as the apex's, and separate by
 *  construction: a host-only cookie on eisenhower.school is not sent to
 *  store.eisenhower.school, so the two never collide. */
export const LANG_COOKIE = "sd_lang";

/** A year — long enough that a family who picked Somali in September is still
 *  reading Somali in May. */
const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The first of our locales an Accept-Language header asks for, honouring
 *  q-weights, or null if it asks for none.
 *
 *  `so;q=0.8, en;q=0.9` must resolve to English, so tags are sorted by weight
 *  before matching — header order alone would answer Somali. A malformed q is
 *  treated as 0 rather than thrown: this runs on every request and a bad header
 *  must not cost a 500. */
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
  /** True when `?lang=` named it. Only an explicit choice is worth remembering
   *  — and it is also the only one worth putting in a canonical URL. */
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
 *  `HttpOnly` because nothing on these pages runs JavaScript, and `Lax` because
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
