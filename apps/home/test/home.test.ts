import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES, dictionaries, localeNames, type PublicCalendarEventDTO } from "@sd/shared";
import worker from "../src/index.js";
import { DISTRICT_PHONES, RESOURCES } from "../src/district.js";
import type { Env } from "../src/env.js";
import { localeFromAcceptLanguage } from "../src/locale.js";
import { escapeHtml } from "../src/page.js";

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
  API_URL: "https://api-directory.eisenhower.school",
};

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request(`https://eisenhower.school${path}`, { headers }), env);
}

async function body(path: string, headers?: Record<string, string>): Promise<string> {
  return await (await get(path, headers)).text();
}

/** Two events off the calendar: one timed, one all-day, which is the whole
 *  matrix the row renderer has to handle. */
const EVENTS: PublicCalendarEventDTO[] = [
  {
    id: "01J0000000000000000000000A",
    kind: "managed",
    title: "Fall Carnival",
    location: "Eisenhower gym",
    description: null,
    start: "2026-10-06T23:00:00.000Z", // 6:00 p.m. in Hopkins
    end: "2026-10-07T01:00:00.000Z",
    allDay: false,
    sourceIds: ["cal"],
    source: { name: "School", color: "#0068A8" },
    volunteerSlug: null,
  },
  {
    id: "01J0000000000000000000000B",
    kind: "imported",
    title: "No school — teacher workshop",
    location: null,
    description: null,
    start: "2026-10-19T00:00:00.000Z",
    end: null,
    allDay: true,
    sourceIds: ["cal"],
    source: { name: "District", color: "#FAAB1C" },
    volunteerSlug: null,
  },
];

/** Stand in for the calendar API. `null` means the read fails, which is the
 *  case the page has to survive without losing anything else. */
function stubCalendar(events: PublicCalendarEventDTO[] | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.includes("/calendar-public/events")) throw new Error(`unexpected fetch: ${url}`);
      if (events === null) throw new Error("network");
      return new Response(JSON.stringify({ events }), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

// Every page render reads the calendar, so give every test a working one by
// default; the tests that care override it.
beforeEach(() => stubCalendar(EVENTS));
afterEach(() => vi.unstubAllGlobals());

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
      expect(html).not.toMatch(
        /\{(school|email|name|feature|language|languages|city|year|district)\}/,
      );
    }
  });

  it("emphasizes the sub-feature wherever the translator put it in the sentence", async () => {
    const html = await body("/?lang=so");
    expect(html).toContain(`<b>${dictionaries.so.neighbors}</b>`);
    expect(html).toContain(`<b>${dictionaries.so.volunteersTitle}</b>`);
    expect(html).not.toContain("\u0000");
  });
});

describe("upcoming events", () => {
  it("shows the next few off the calendar, linking each to its own page", async () => {
    const html = await body("/?lang=en");
    expect(html).toContain("Fall Carnival");
    expect(html).toContain("Eisenhower gym");
    // Content identity minted in the SCHOOL's timezone: 23:00 UTC is the 6th
    // in Hopkins, not the 7th.
    expect(html).toContain(
      'href="https://calendar.eisenhower.school/e/2026-10-06/fall-carnival?lang=en"',
    );
    expect(html).toContain(dictionaries.en.upcomingEvents);
  });

  it("gives an all-day event the words rather than a midnight clock time", async () => {
    const html = await body("/?lang=en");
    expect(html).toContain(escapeHtml(dictionaries.en.allDay));
    expect(html).toContain("Mon, Oct 19");
    expect(html).not.toContain("12:00 AM");
    // A timed one still gets its range.
    expect(html).toMatch(/6:00\s*[–-]\s*8:00\s*PM/);
  });

  it("reads the ANONYMOUS calendar route, never the members-only twin", async () => {
    await body("/");
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/calendar-public/events");
    expect(String(url)).not.toMatch(/\/calendar\/events/);
  });

  it("renders the whole page anyway when the calendar is unreachable", async () => {
    stubCalendar(null);
    const html = await body("/?lang=en");
    expect(html).not.toContain(dictionaries.en.upcomingEvents);
    expect(html).not.toContain("Fall Carnival");
    // Everything that does not depend on that read is still here.
    expect(html).toContain(dictionaries.en.landingCreateAccount);
    expect(html).toContain(dictionaries.en.landingHelpTitle);
  });

  it("hides the block when the calendar has nothing coming up", async () => {
    stubCalendar([]);
    const html = await body("/?lang=en");
    expect(html).not.toContain(dictionaries.en.upcomingEvents);
  });
});

describe("who to call, and where to look", () => {
  it("carries every district number, as a dialable link", async () => {
    const html = await body("/?lang=en");
    for (const row of DISTRICT_PHONES) {
      expect(html).toContain(escapeHtml(dictionaries.en[row.key]));
      expect(html).toContain(`>${row.phone}</a>`);
      expect(html).toContain(`href="tel:+1${row.phone.replace(/-/g, "")}"`);
    }
    // Eisenhower's own two, which are the reason this block exists.
    expect(html).toContain('href="tel:+19529884300"'); // school office
    expect(html).toContain('href="tel:+19529885391"'); // interpreters
  });

  it("links every page the mailing points families at, with why", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      for (const r of RESOURCES) {
        expect(html).toContain(`href="${r.href}"`);
        expect(html).toContain(escapeHtml(r.label));
        expect(html).toContain(escapeHtml(dictionaries[locale][r.key]));
      }
    }
  });

  it("makes the printed URL clickable, without doubling up the link for AT", async () => {
    const html = await body("/?lang=en");
    for (const r of RESOURCES) {
      // The visible URL is a real link to the same page as the name above it…
      expect(html).toContain(
        `<a class="res-url" href="${r.href}" aria-hidden="true" tabindex="-1">${r.label}</a>`,
      );
    }
    // …but a screen reader and the tab key still get one link per row.
    const rows = html.split('class="res-name"').length - 1;
    expect(rows).toBe(RESOURCES.length);
    expect(html.split('class="res-url"').length - 1).toBe(RESOURCES.length);
    expect(html.match(/class="res-url"[^>]*aria-hidden="true"/g)).toHaveLength(RESOURCES.length);
  });

  it("turns the bus address into a mailto wherever the translator put it", async () => {
    for (const locale of LOCALES) {
      const html = await body(`/?lang=${locale}`);
      expect(html).toContain(
        '<a href="mailto:SchoolBus@HopkinsSchools.org">SchoolBus@HopkinsSchools.org</a>',
      );
      // The slot is filled, not left behind, in every language.
      expect(html).not.toContain("{email}");
    }
  });

  it("states the school hours in the reader's own clock convention", async () => {
    expect(await body("/?lang=en")).toMatch(/7:40\s*(AM)?\s*[–-]\s*2:10\s*PM/);
    // Chinese runs on a 24-hour clock, so the same two instants read differently.
    expect(await body("/?lang=zh")).toMatch(/07:40\s*[–-]\s*14:10/);
  });

  it("carries no attribution line and no other-schools fold", async () => {
    // Both were removed on purpose: the block is the school's own contacts, not
    // a reprint of the mailing, and the district is already linked from the
    // header and from every resource row.
    const html = await body("/?lang=en");
    expect(html).not.toContain("ISD 270");
    expect(html).not.toContain("Published by");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
    // What replaced neither of them: the three columns are still all there.
    expect(html).toContain(dictionaries.en.landingContactsDistrict);
    expect(html).toContain(dictionaries.en.landingResourcesTitle);
    expect(html).toContain("Eisenhower Elementary");
  });
});

describe("routing", () => {
  it("301s www to the apex, preserving path and query", async () => {
    const res = await worker.fetch(new Request("https://www.eisenhower.school/?lang=zh"), env);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://eisenhower.school/?lang=zh");
  });

  it("hands the vanity paths to the app that owns them", async () => {
    expect((await get("/calendar")).headers.get("location")).toBe(
      "https://calendar.eisenhower.school/?lang=en",
    );
    expect((await get("/subscribe")).headers.get("location")).toBe(
      "https://newsletter.eisenhower.school/subscribe?lang=en",
    );
    expect((await get("/sign-in?lang=es")).headers.get("location")).toBe(
      "https://directory.eisenhower.school/sign-in?lang=es",
    );
  });

  it("404s an unknown path in the reader's language rather than redirecting", async () => {
    const res = await get("/nope", { "accept-language": "so" });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('<html lang="so">');
    expect(html).toContain("noindex");
  });

  it("serves a robots.txt that allows the page and names the sitemap", async () => {
    const res = await get("/robots.txt");
    const txt = await res.text();
    expect(txt).toContain("Allow: /");
    expect(txt).toContain("https://eisenhower.school/sitemap.xml");
  });

  it("lists every language in the sitemap, with escaped ampersands", async () => {
    const xml = await (await get("/sitemap.xml")).text();
    for (const locale of LOCALES) expect(xml).toContain(`/?lang=${locale}`);
    expect(xml).not.toMatch(/&(?!amp;)/);
  });

  it("refuses a write", async () => {
    const res = await worker.fetch(
      new Request("https://eisenhower.school/", { method: "POST" }),
      env,
    );
    expect(res.status).toBe(405);
  });
});

describe("escaping", () => {
  it("escapes values that come from configuration", async () => {
    const hostile: Env = { ...env, SCHOOL_NAME: '<script>alert(1)</script>' };
    const html = await (
      await worker.fetch(new Request("https://eisenhower.school/"), hostile)
    ).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("cannot be used to close the JSON-LD block early", async () => {
    const hostile: Env = { ...env, SCHOOL_CITY: "</script><script>alert(1)</script>" };
    const html = await (
      await worker.fetch(new Request("https://eisenhower.school/"), hostile)
    ).text();
    expect(html).not.toContain("</script><script>alert(1)");
    // One ld+json block, and it still parses.
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1];
    expect(JSON.parse(json!).address.addressLocality).toBe(
      "</script><script>alert(1)</script>",
    );
  });
});
