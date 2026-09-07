// i18n context. Strings come from @sd/shared; member content is never translated.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import {
  capabilityLabelKeys,
  dictionaries,
  interpolate,
  localeFromSearch,
  localeFromTag,
  LOCALE_PARAM,
  type Capability,
  type Locale,
  type Strings,
} from "@sd/shared";
import { api } from "../lib/api.js";

const STORAGE_KEY = "sd_locale";

/** The language to open in, most explicit signal first:
 *
 *   1. a `?lang=` deep link — the most recent and most deliberate statement of
 *      what this person reads, and the whole point of handing someone the link;
 *   2. a choice made here before, from the language picker or an earlier link;
 *   3. the browser's own language setting;
 *   4. English.
 *
 *  Steps 1 and 3 go through the same `localeFromTag` rule in @sd/shared, so a
 *  pasted code and a browser setting can't disagree, and adding a locale to
 *  LOCALES is all it takes for both to recognize it. */
function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
  return (
    localeFromSearch(window.location.search) ??
    (saved && saved in dictionaries ? saved : null) ??
    localeFromTag(navigator.language) ??
    "en"
  );
}

/** Take the `lang` parameter back out of the address bar once it has been
 *  applied. Without this it rides along into every link someone copies from
 *  here and into their history, which turns a one-time "read this in Somali"
 *  into a preference they never chose. */
function stripLocaleParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(LOCALE_PARAM)) return;
  url.searchParams.delete(LOCALE_PARAM);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** The translate function returned by useI18n — handy when passing `t` to a
 *  module-level helper. */
export type I18nT = (key: keyof Strings, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a key with optional `{placeholder}` interpolation. */
  t: I18nT;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, school = "Eisenhower PTO" }: { children: ReactNode; school?: string }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLocaleState(l);
  }, []);

  // One place that owns <html lang>, so it can't drift from what is on screen.
  // It matters to screen readers, to hyphenation, and to the browser's own
  // offer to translate the page.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Consume a `?lang=` deep link once, on arrival. `detectLocale` has already
  // read it into state; this is the part with side effects — remember the
  // choice the way the picker would, and take the parameter back out of the URL.
  //
  // The account write is best-effort and unconditional: most of these links are
  // opened by people with no session at all (the public agenda, a volunteer
  // sheet), where it simply 401s and is caught. Asking the session first would
  // mean waiting on /me before honouring something the reader already asked for.
  useEffect(() => {
    const linked = localeFromSearch(window.location.search);
    if (!linked) return;
    setLocale(linked);
    void api.setLocale(linked).catch(() => {});
    stripLocaleParam();
  }, [setLocale]);

  const t = useCallback(
    (key: keyof Strings, vars?: Record<string, string | number>) => {
      const raw = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
      return interpolate(raw, { school, ...vars });
    },
    [locale, school],
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

/** Localized label for a Capability enum (e.g. "household_admin" → "Household
 *  admin" / "Administrador del hogar"). Pass a component's `t` from useI18n. */
export function capLabel(t: I18nT, c: Capability): string {
  return t(capabilityLabelKeys[c]);
}
