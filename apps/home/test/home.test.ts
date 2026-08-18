import { describe, expect, it } from "vitest";
import { LOCALES, dictionaries, localeNames } from "@sd/shared";
import worker from "../src/index.js";
import type { Env } from "../src/env.js";
import { localeFromAcceptLanguage } from "../src/locale.js";

const env: Env = {
  SCHOOL_NAME: "Eisenhower PTO",
  SITE_ORIGIN: "https://eisenhower.school",
  DIRECTORY_URL: "https://directory.eisenhower.school",
  CALENDAR_URL: "https://calendar.eisenhower.school",
  NEWSLETTER_URL: "https://newsletter.eisenhower.school",
  SCHOOL_SITE_URL: "https://eisenhower.hopkinsschools.org/",
  FEEDBACK_EMAIL: "admin@eisenhower.school",
  SCHOOL_CITY: "Hopkins",
  SCHOOL_REGION: "Minnesota",
  SCHOOL_REGION_CODE: "MN",
};

function get(path: string, headers: Record<string, string> = {}): Response {
  return worker.fetch(new Request(`https://eisenhower.school${path}`, { headers }), env);
}

async function body(path: string, headers?: Record<string, string>): Promise<string> {
  return await get(path, headers).text();
}

describe("Accept-Language", () => {
  it("picks the highest-weighted supported language, not the first listed", () => {
    // Header order would answer Somali; the q-weights say English.
    expect(localeFromAcceptLanguage("so;q=0.8, en;q=0.9")).toBe("en");
  });

  it("matches on the primary subtag", () => {
    expect(localeFromAcceptLanguage("es-MX,es;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("zh-Hans-CN")).toBe("zh");
  });

  it("ignores languages we do not have", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBeNull();
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });

  it("survives a malformed q without throwing", () => {
    expect(localeFromAcceptLanguage("so;q=banana, en")).toBe("en");
  });

  it("drops a q=0 rejection", () => {
    expect(localeFromAcceptLanguage("en;q=0, so;q=0.5")).toBe("so");
  });
});

describe("the landing page", () => {
  it("greets in every language we have, whichever one is being read", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      for (const other of LOCALES) {
        expect(html).toContain(dictionaries[other].landingWelcome);
      }
    }
  });

  it("renders in the language asked for, and says so in <html lang>", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain('<html lang="so">');
    expect(html).toContain(dictionaries.so.landingCreateAccount);
    expect(html).not.toContain(dictionaries.en.landingCreateAccount);
  });

  it("falls back to Accept-Language, then to English", async () => {
    expect(await body("/", { "accept-language": "es-MX,es;q=0.9" })).toContain('<html lang="es">');
    expect(await body("/", { "accept-language": "fr" })).toContain('<html lang="en">');
    expect(await body("/")).toContain('<html lang="en">');
  });

  it("lets ?lang beat the browser's preference", async () => {
    const html = await body("/?lang=zh", { "accept-language": "en-US" });
    expect(html).toContain('<html lang="zh">');
  });

  it("marks the current language as current and the others as links", async () => {
    const html = await body("/?lang=es");
    expect(html).toContain(`<strong lang="es" aria-current="true">${dictionaries.es.landingWelcome}`);
    expect(html).toContain('<a lang="so" href="/?lang=so"');
    // The stack never links to the language you are already reading.
    expect(html).not.toContain('<a lang="es"');
  });

  it("labels each language link in that language", async () => {
    const html = await body("/?lang=en");
    expect(html).toContain(
      dictionaries.so.landingReadIn.replace("{language}", localeNames.so.native),
    );
  });

  it("carries the reader's language into every app link", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain("https://directory.eisenhower.school/sign-in?lang=so");
    expect(html).toContain("https://calendar.eisenhower.school/?lang=so");
    expect(html).toContain("https://newsletter.eisenhower.school/?lang=so");
  });

  it("keeps a way out to the school's own site, which this domain used to be", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain("https://eisenhower.hopkinsschools.org/");
      expect(html).toContain(dictionaries[locale].landingSchoolSiteLink);
    }
  });

  it("says where the school is, in every language", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      // The place name itself is configuration and stays in Latin script; only
      // the sentence around it in the footer is translated.
      expect(html).toContain("Hopkins, Minnesota");
      expect(html).toContain(
        dictionaries[locale].landingLocatedIn
          .replace("{school}", "Eisenhower PTO")
          .replace("{city}", "Hopkins, Minnesota"),
      );
    }
  });

  it("puts the location in the description a search engine reads", async () => {
    const html = await body("/?lang=en");
    expect(html).toMatch(/<meta name="description" content="[^"]*Hopkins, Minnesota/);
  });

  it("publishes the address as structured data, with the region as a code", async () => {
    const html = await body("/");
    const json = html.match(
      /<script type="application\/ld\+json">(.*?)<\/script>/s,
    )?.[1];
    expect(json).toBeTruthy();
    const data = JSON.parse(json!);
    expect(data.address).toEqual({
      "@type": "PostalAddress",
      addressLocality: "Hopkins",
      // "MN", not "Minnesota" — schema.org wants the subdivision code here even
      // though the visible stamp spells the state out.
      addressRegion: "MN",
      addressCountry: "US",
    });
    expect(data.name).toBe("Eisenhower PTO");
    expect(data.url).toBe("https://eisenhower.school/");
  });

  it("asks to be indexed — unlike every members-only app in this repo", async () => {
    const html = await body("/");
    expect(html).not.toContain("noindex");
    expect(html).toContain('<link rel="canonical" href="https://eisenhower.school/" />');
    for (const locale of LOCALES) {
      expect(html).toContain(`hreflang="${locale}" href="https://eisenhower.school/?lang=${locale}"`);
    }
    expect(html).toContain('hreflang="x-default"');
  });

  it("canonicalizes an explicitly-chosen language to its own URL", async () => {
    const html = await body("/?lang=zh");
    expect(html).toContain('<link rel="canonical" href="https://eisenhower.school/?lang=zh" />');
  });

  it("leaves no placeholder uninterpolated", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      // Any `{word}` that survived is a template we forgot to fill. `--i:0` and
      // CSS braces are excluded by requiring a bare word inside the braces.
      expect(html).not.toMatch(/\{(school|email|name|feature|language|languages|city)\}/);
    }
  });

  it("emphasizes the sub-feature wherever the translator put it in the sentence", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain(`<b>${dictionaries.so.neighbors}</b>`);
    expect(html).toContain(`<b>${dictionaries.so.volunteersTitle}</b>`);
    expect(html).not.toContain("\u0000");
  });
});

describe("routing", () => {
  it("301s www to the apex, preserving path and query", () => {
    const res = worker.fetch(new Request("https://www.eisenhower.school/?lang=zh"), env);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://eisenhower.school/?lang=zh");
  });

  it("hands the vanity paths to the app that owns them", () => {
    expect(get("/calendar").headers.get("location")).toBe(
      "https://calendar.eisenhower.school/?lang=en",
    );
    expect(get("/subscribe").headers.get("location")).toBe(
      "https://newsletter.eisenhower.school/subscribe?lang=en",
    );
    expect(get("/sign-in?lang=es").headers.get("location")).toBe(
      "https://directory.eisenhower.school/sign-in?lang=es",
    );
  });

  it("404s an unknown path in the reader's language rather than redirecting", async () => {
    const res = get("/nope", { "accept-language": "so" });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('<html lang="so">');
    expect(html).toContain("noindex");
  });

  it("serves a robots.txt that allows the page and names the sitemap", async () => {
    const res = get("/robots.txt");
    const txt = await res.text();
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("https://eisenhower.school/sitemap.xml");
  });

  it("lists every language in the sitemap, with escaped ampersands", async () => {
    const xml = await get("/sitemap.xml").text();
    for (const locale of LOCALES) expect(xml).toContain(`/?lang=${locale}`);
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it("refuses a write", () => {
    const res = worker.fetch(new Request("https://eisenhower.school/", { method: "POST" }), env);
    expect(res.status).toBe(405);
  });
});

describe("escaping", () => {
  it("escapes values that come from configuration", async () => {
    const hostile: Env = { ...env, SCHOOL_NAME: '<script>alert(1)</script>' };
    const html = await worker
      .fetch(new Request("https://eisenhower.school/"), hostile)
      .text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("cannot be used to close the JSON-LD block early", async () => {
    const hostile: Env = { ...env, SCHOOL_CITY: "</script><script>alert(1)</script>" };
    const html = await worker
      .fetch(new Request("https://eisenhower.school/"), hostile)
      .text();
    expect(html).not.toContain("</script><script>alert(1)");
    // One ld+json block, and it still parses.
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(JSON.parse(json!).address.addressLocality).toBe(
      "</script><script>alert(1)</script>",
    );
  });
});
