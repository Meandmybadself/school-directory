// i18n context. Strings come from @sd/shared; member content is never translated.
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { dictionaries, interpolate, type Locale, type Strings } from "@sd/shared";

const STORAGE_KEY = "sd_locale";

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (saved && saved in dictionaries) return saved;
  const nav = navigator.language.slice(0, 2);
  if (nav === "es") return "es";
  if (nav === "zh") return "zh";
  return "en";
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a key with optional `{placeholder}` interpolation. */
  t: (key: keyof Strings, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, school = "Eisenhower" }: { children: ReactNode; school?: string }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLocaleState(l);
    document.documentElement.lang = l;
  }, []);

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
