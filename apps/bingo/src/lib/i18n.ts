// Locale resolution + translate, the non-React twin of the SPAs' I18nProvider.
// Strings come from @sd/shared (invariant 6); the board's letters and numbers
// are the game itself, not copy, so almost nothing here is ever on screen.

import {
  dictionaries,
  interpolate,
  localeFromSearch,
  localeFromTag,
  LOCALE_PARAM,
  type Locale,
  type Strings,
} from "@sd/shared";

const STORAGE_KEY = "sd_locale";

/** The language to open in, most explicit signal first — the same chain every
 *  sibling SPA walks: a `?lang=` deep link, a choice made here before, the
 *  browser's language, English. */
function detectLocale(): Locale {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private windows); detection still works.
  }
  return (
    localeFromSearch(window.location.search) ??
    (saved && saved in dictionaries ? (saved as Locale) : null) ??
    localeFromTag(navigator.language) ??
    "en"
  );
}

export const locale: Locale = (() => {
  const resolved = detectLocale();
  // Remember the choice ONLY where an explicit ?lang= was honoured — detection
  // never promotes itself into a preference (the apps/home rule) — then take
  // the parameter back out of the address bar, like every sibling SPA.
  if (localeFromSearch(window.location.search)) {
    try {
      localStorage.setItem(STORAGE_KEY, resolved);
    } catch {
      // A forgotten preference is fine; the deep link already applied.
    }
    const url = new URL(window.location.href);
    url.searchParams.delete(LOCALE_PARAM);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  document.documentElement.lang = resolved;
  return resolved;
})();

/** Translate a key with optional `{placeholder}` interpolation. */
export function t(key: keyof Strings, vars?: Record<string, string | number>): string {
  return interpolate(dictionaries[locale][key], vars);
}
