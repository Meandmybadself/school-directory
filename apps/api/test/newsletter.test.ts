import { describe, it, expect } from "vitest";
import {
  EVENTS_BLOCK_TYPE,
  NO_EVENTS,
  newsletterExcerpt,
  renderNewsletterBodyHtml,
  renderNewsletterText,
  sanitizeNewsletterDoc,
  collectEventsBlocks,
  type CalendarEventDTO,
  type NewsletterNode,
  issueSlug,
  slugifyTitle,
} from "@sd/shared";
import {
  coerceNewsletterSettings,
  mergeAudience,
  isEmail,
} from "../src/lib/newsletter.js";

const doc = (...content: NewsletterNode[]): NewsletterNode => ({ type: "doc", content });
const para = (text: string): NewsletterNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("newsletter sanitizer", () => {
  it("rejects anything that isn't a document", () => {
    expect(sanitizeNewsletterDoc(null)).toBeNull();
    expect(sanitizeNewsletterDoc("<p>hi</p>")).toBeNull();
    expect(sanitizeNewsletterDoc({ type: "paragraph" })).toBeNull();
  });

  it("drops unknown node types but keeps their text", () => {
    const out = sanitizeNewsletterDoc(
      doc({ type: "script", content: [{ type: "text", text: "alert(1)" }] }),
    );
    // The node is gone; the text survives as a bare text node, exactly as
    // htmlToText keeps content while stripping tags.
    expect(JSON.stringify(out)).not.toContain("script");
    expect(JSON.stringify(out)).toContain("alert(1)");
  });

  it("strips link marks whose href isn't http(s) or mailto", () => {
    const withJs = doc({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "click",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
      ],
    });
    const out = sanitizeNewsletterDoc(withJs)!;
    expect(JSON.stringify(out)).not.toContain("javascript");
    // The text itself is preserved — only the dangerous mark is removed.
    expect(JSON.stringify(out)).toContain("click");
  });

  it("keeps a legitimate link", () => {
    const out = sanitizeNewsletterDoc(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://x.test/a" } }] },
        ],
      }),
    )!;
    expect(JSON.stringify(out)).toContain("https://x.test/a");
  });

  it("drops images that aren't remote URLs", () => {
    expect(
      JSON.stringify(sanitizeNewsletterDoc(doc({ type: "image", attrs: { src: "data:image/png;base64,AAA" } }))),
    ).not.toContain("data:");
    expect(
      JSON.stringify(sanitizeNewsletterDoc(doc({ type: "image", attrs: { src: "https://cdn.test/a.png" } }))),
    ).toContain("https://cdn.test/a.png");
  });

  it("demotes an out-of-range heading level rather than emitting it", () => {
    const out = sanitizeNewsletterDoc(doc({ type: "heading", attrs: { level: 9 }, content: [] }))!;
    expect((out.content![0]!.attrs as { level: number }).level).toBe(3);
  });

  it("clamps an events block's lookahead window", () => {
    const out = sanitizeNewsletterDoc(
      doc({ type: EVENTS_BLOCK_TYPE, attrs: { blockId: "a", lookaheadDays: 99999 } }),
    )!;
    expect((out.content![0]!.attrs as { lookaheadDays: number }).lookaheadDays).toBe(365);
  });
});

describe("newsletter renderer", () => {
  it("escapes text rather than emitting it as markup", () => {
    const html = renderNewsletterBodyHtml(doc(para('<img src=x onerror="alert(1)">')), NO_EVENTS, {
      mode: "email",
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("inlines styles for email and uses classes for web", () => {
    const email = renderNewsletterBodyHtml(doc(para("hi")), NO_EVENTS, { mode: "email" });
    const web = renderNewsletterBodyHtml(doc(para("hi")), NO_EVENTS, { mode: "web" });
    // Email clients strip <style> blocks, so every rule has to ride inline.
    expect(email).toContain("style=");
    expect(email).not.toContain("class=");
    expect(web).toContain('class="nl-p"');
    expect(web).not.toContain("style=");
  });

  it("renders resolved events and says so when there are none", () => {
    const block: NewsletterNode = {
      type: EVENTS_BLOCK_TYPE,
      attrs: { blockId: "b1", calendarIds: [], lookaheadDays: 14, heading: "This week" },
    };
    const event: CalendarEventDTO = {
      id: "e1",
      kind: "imported",
      title: "Fall Concert",
      location: "Gym",
      description: null,
      start: "2026-09-15T23:00:00.000Z",
      end: null,
      allDay: false,
      sourceIds: ["s1"],
      source: { name: "Events", color: "#0068A8" },
    };

    const withEvents = renderNewsletterBodyHtml(doc(block), () => [event], {
      mode: "email",
      timeZone: "America/Chicago",
    });
    expect(withEvents).toContain("Fall Concert");
    expect(withEvents).toContain("This week");
    expect(withEvents).toContain("Gym");

    const empty = renderNewsletterBodyHtml(doc(block), NO_EVENTS, { mode: "email" });
    expect(empty).toContain("No upcoming events");
  });

  it("reads an all-day event's date in UTC, not the render zone", () => {
    // Stored at midnight UTC. Read in Central it would slide back to the 14th.
    const allDay: CalendarEventDTO = {
      id: "e2",
      kind: "imported",
      title: "No School",
      location: null,
      description: null,
      start: "2026-09-15T00:00:00.000Z",
      end: null,
      allDay: true,
      sourceIds: ["s1"],
      source: { name: "Events", color: "#0068A8" },
    };
    const html = renderNewsletterBodyHtml(
      doc({ type: EVENTS_BLOCK_TYPE, attrs: { blockId: "b", calendarIds: [], lookaheadDays: 7, heading: null } }),
      () => [allDay],
      { mode: "email", timeZone: "America/Chicago" },
    );
    expect(html).toContain("Sep 15");
    expect(html).not.toContain("Sep 14");
  });

  it("spells out link destinations in the plain-text part", () => {
    const text = renderNewsletterText(
      doc({
        type: "paragraph",
        content: [
          { type: "text", text: "sign up", marks: [{ type: "link", attrs: { href: "https://x.test/f" } }] },
        ],
      }),
      NO_EVENTS,
    );
    expect(text).toContain("sign up (https://x.test/f)");
  });

  it("leaves events blocks out of the excerpt entirely", () => {
    // Otherwise an archive card reads "Coming up No upcoming events." as though
    // that were the issue's own text.
    const excerpt = newsletterExcerpt(
      doc(
        para("Welcome back!"),
        { type: EVENTS_BLOCK_TYPE, attrs: { blockId: "b", lookaheadDays: 14, heading: "Coming up" } },
      ),
    );
    expect(excerpt).toBe("Welcome back!");
  });

  it("builds an excerpt that stops at a word boundary", () => {
    const long = para("word ".repeat(80).trim());
    const excerpt = newsletterExcerpt(doc(long), 40);
    expect(excerpt.length).toBeLessThanOrEqual(41); // + the ellipsis
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("finds every events block in document order", () => {
    const blocks = collectEventsBlocks(
      doc(
        { type: EVENTS_BLOCK_TYPE, attrs: { blockId: "first", lookaheadDays: 7 } },
        para("between"),
        { type: EVENTS_BLOCK_TYPE, attrs: { blockId: "second", lookaheadDays: 30 } },
      ),
    );
    expect(blocks.map((b) => b.blockId)).toEqual(["first", "second"]);
    expect(blocks[1]!.lookaheadDays).toBe(30);
  });
});

describe("slugs", () => {
  it("folds accents and punctuation into a URL segment", () => {
    expect(slugifyTitle("Año Nuevo: What's New!")).toBe("ano-nuevo-what-s-new");
  });

  it("prefixes the date so the URL reads as a date", () => {
    expect(issueSlug("Back to School", "2026-08-15T12:00:00.000Z")).toBe("2026-08-15-back-to-school");
  });

  it("falls back to the date alone when the title has no Latin characters", () => {
    expect(issueSlug("学校通讯", "2026-08-15T12:00:00.000Z")).toBe("2026-08-15");
  });
});

describe("audience", () => {
  const user = (id: string, email: string, optedOut = false) => ({ id, email, optedOut });
  const sub = (id: string, email: string, unsubscribed = false) => ({ id, email, unsubscribed });

  it("unions members and standalone subscribers", () => {
    const out = mergeAudience([user("u1", "a@x.test")], [sub("s1", "b@x.test")]);
    expect(out.map((m) => m.email).sort()).toEqual(["a@x.test", "b@x.test"]);
  });

  it("dedupes one address reachable both ways, keeping both handles", () => {
    const out = mergeAudience([user("u1", "A@x.test")], [sub("s1", "a@x.test")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ email: "a@x.test", userId: "u1", subscriberId: "s1" });
  });

  it("excludes opted-out members", () => {
    expect(mergeAudience([user("u1", "a@x.test", true)], [])).toEqual([]);
  });

  it("excludes unsubscribed subscribers", () => {
    expect(mergeAudience([], [sub("s1", "a@x.test", true)])).toEqual([]);
  });

  it("lets a member's opt-out override a stale subscriber row for the same address", () => {
    // Otherwise unsubscribing in the app would silently keep mailing anyone an
    // admin had also added to the standalone list.
    expect(mergeAudience([user("u1", "a@x.test", true)], [sub("s1", "a@x.test")])).toEqual([]);
  });
});

describe("settings coercion", () => {
  const base = {
    senderName: "Base",
    senderEmail: "base@x.test",
    replyTo: null,
    footerText: "footer",
    mailingAddress: "addr",
    unsubscribeWording: "wording",
    logoUrl: null,
    accentColor: "#0068A8",
    newsletterTitle: "Title",
    defaultCalendarIds: [],
    defaultLookaheadDays: 14,
  };

  it("keeps the previous value for a malformed field", () => {
    const out = coerceNewsletterSettings({ accentColor: "not-a-color", senderEmail: "nope" }, base);
    expect(out.accentColor).toBe("#0068A8");
    expect(out.senderEmail).toBe("base@x.test");
  });

  it("accepts an empty sender address as 'fall back to EMAIL_FROM'", () => {
    expect(coerceNewsletterSettings({ senderEmail: "" }, base).senderEmail).toBe("");
  });

  it("clamps the default lookahead window", () => {
    expect(coerceNewsletterSettings({ defaultLookaheadDays: 0 }, base).defaultLookaheadDays).toBe(1);
    expect(coerceNewsletterSettings({ defaultLookaheadDays: 5000 }, base).defaultLookaheadDays).toBe(365);
  });

  it("ignores a non-https logo URL", () => {
    expect(coerceNewsletterSettings({ logoUrl: "javascript:x" }, base).logoUrl).toBeNull();
  });
});

describe("email validation", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    expect(isEmail("a@x.test")).toBe(true);
    expect(isEmail("a@x")).toBe(false);
    expect(isEmail("a b@x.test")).toBe(false);
    expect(isEmail("")).toBe(false);
  });
});
