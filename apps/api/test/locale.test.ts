// Locale resolution — the deep-link parameter and the tag matcher behind it.
//
// These live in @sd/shared and are exercised from here for the same reason
// newsletterEvents.test.ts is: shared has no test runner of its own, and both
// the Worker and all three SPAs depend on this behaving identically.

import { describe, expect, it } from "vitest";
import {
  dictionaries,
  LOCALE_PARAM,
  LOCALES,
  localeFromSearch,
  localeFromTag,
  localeNames,
  type Strings,
} from "@sd/shared";

describe("localeFromTag", () => {
  it("accepts a bare code", () => {
    expect(localeFromTag("so")).toBe("so");
  });

  it("accepts a full BCP-47 tag, matching on the primary subtag", () => {
    expect(localeFromTag("so-SO")).toBe("so");
    expect(localeFromTag("es-MX")).toBe("es");
    expect(localeFromTag("zh-Hans-CN")).toBe("zh");
  });

  it("is case-insensitive and tolerates an underscore", () => {
    expect(localeFromTag("SO_so")).toBe("so");
  });

  it("returns null for a language we don't have, rather than falling back", () => {
    // The caller's own chain (saved choice, then browser language) is a better
    // answer than silently pretending a typo meant English.
    expect(localeFromTag("fr")).toBeNull();
    expect(localeFromTag("sox")).toBeNull();
    expect(localeFromTag("")).toBeNull();
    expect(localeFromTag(null)).toBeNull();
  });
});

describe("localeFromSearch", () => {
  it("reads ?lang= with or without the leading question mark", () => {
    expect(localeFromSearch("?lang=so")).toBe("so");
    expect(localeFromSearch("lang=so")).toBe("so");
  });

  it("finds the parameter among others, in any position", () => {
    expect(localeFromSearch("?from=text&lang=es&limit=20")).toBe("es");
  });

  it("ignores a query that names no language", () => {
    expect(localeFromSearch("")).toBeNull();
    expect(localeFromSearch("?limit=20")).toBeNull();
    expect(localeFromSearch("?lang=")).toBeNull();
    expect(localeFromSearch("?language=so")).toBeNull();
  });

  it("does not match a parameter that merely ends in the name", () => {
    expect(localeFromSearch("?mylang=so")).toBeNull();
  });

  it("survives a malformed percent-escape instead of throwing on page boot", () => {
    expect(localeFromSearch("?lang=%E0%A4%A")).toBeNull();
  });

  it("uses the documented parameter name", () => {
    expect(localeFromSearch(`?${LOCALE_PARAM}=zh`)).toBe("zh");
  });
});

describe("the locale set", () => {
  it("has a dictionary and a name for every locale, and vice versa", () => {
    // The picker renders straight off LOCALES + localeNames, so a locale added
    // to one and not the others would render a blank row or throw at `t`.
    expect(Object.keys(dictionaries).sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(localeNames).sort()).toEqual([...LOCALES].sort());
  });

  it("gives every locale the full key set, with nothing left in English", () => {
    const keys = Object.keys(dictionaries.en) as (keyof Strings)[];
    for (const locale of LOCALES) {
      const dict = dictionaries[locale];
      expect(Object.keys(dict).sort()).toEqual([...keys].sort());
      for (const key of keys) expect(dict[key], `${locale}.${key}`).toBeTruthy();
    }
  });

  it("keeps every {placeholder} a string carries in English", () => {
    // A dropped placeholder is invisible until it renders as a missing name or
    // count in front of a family that reads that language.
    const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
    for (const key of Object.keys(dictionaries.en) as (keyof Strings)[]) {
      const want = placeholders(dictionaries.en[key]);
      if (want.length === 0) continue;
      for (const locale of LOCALES) {
        expect(placeholders(dictionaries[locale][key]), `${locale}.${key}`).toEqual(want);
      }
    }
  });
});
