// Which of our four languages this visitor reads.
//
// Two inputs, in priority order: an explicit `?lang=` (the same one-shot deep
// link every SPA already honours — see LOCALE_PARAM in @sd/shared) and the
// browser's Accept-Language header. There is deliberately no cookie: this page
// has no session, holds no state, and a language chosen here travels onward in
// the query string of every outbound link instead.

import { LOCALES, localeFromSearch, localeFromTag, type Locale } from "@sd/shared";

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

export interface Resolved {
  locale: Locale;
  /** True when `?lang=` named it, rather than the header or the fallback. Only
   *  an explicit choice is worth putting in the canonical URL. */
  explicit: boolean;
}

export function resolveLocale(url: URL, request: Request): Resolved {
  const asked = localeFromSearch(url.search);
  if (asked) return { locale: asked, explicit: true };
  const accepted = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return { locale: accepted ?? "en", explicit: false };
}

export { LOCALES };
