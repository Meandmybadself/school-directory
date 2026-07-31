import { describe, it, expect } from "vitest";
import {
  EVENTS_BLOCK_TYPE,
  NO_EVENTS,
  newsletterExcerpt,
  renderNewsletterBodyHtml,
  renderNewsletterEmailHtml,
  renderNewsletterText,
  sanitizeNewsletterDoc,
  sanitizeFooterHtml,
  footerHtmlOf,
  footerTextOf,
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

describe("footer html sanitizer", () => {
  // This is the only raw-HTML seam in the newsletter, and its output lands on
  // the PUBLIC archive pages — so these assert what must never survive, not
  // just what should.
  it("keeps ordinary footer markup", () => {
    const out = sanitizeFooterHtml(
      '<p style="text-align:center">Sent by the <strong>PTO</strong> — <a href="https://x.test/board">the board</a></p>',
    );
    expect(out).toContain("<strong>PTO</strong>");
    expect(out).toContain('style="text-align:center"');
    expect(out).toContain('href="https://x.test/board"');
  });

  it("drops scripts along with their contents", () => {
    expect(sanitizeFooterHtml('<p>hi</p><script>alert(1)</script>')).toBe("<p>hi</p>");
    expect(sanitizeFooterHtml('<style>body{display:none}</style>ok')).toBe("ok");
    expect(sanitizeFooterHtml('<iframe src="https://evil.test"><p>fallback</p></iframe>')).toBe("");
  });

  it("cannot be escaped by an unclosed opaque element", () => {
    // An unterminated <script> must swallow the rest, not resume emitting.
    expect(sanitizeFooterHtml("<p>a</p><script>alert(1)<p>b</p>")).toBe("<p>a</p>");
    // …and a nested one must not end the skip early.
    expect(sanitizeFooterHtml("<script><script></script>alert(1)</script>x")).toBe("x");
  });

  it("strips event handlers and unsafe urls", () => {
    expect(sanitizeFooterHtml('<p onclick="steal()">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeFooterHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeFooterHtml('<img src="javascript:alert(1)" />')).toBe("<img />");
    expect(sanitizeFooterHtml('<a href="https://x.test" onmouseover="x">y</a>')).not.toContain(
      "onmouseover",
    );
  });

  it("refuses css that fetches or executes", () => {
    expect(sanitizeFooterHtml('<div style="background:url(https://t.test/p.gif)">x</div>')).toBe(
      "<div>x</div>",
    );
    expect(sanitizeFooterHtml('<div style="width:expression(alert(1))">x</div>')).toBe("<div>x</div>");
    // A quote-escape attempt loses the attribute, never the surrounding tag.
    expect(sanitizeFooterHtml('<div style="color:red&quot; onload=&quot;x">y</div>')).toBe(
      "<div>y</div>",
    );
  });

  it("forces external links to open safely", () => {
    const out = sanitizeFooterHtml('<a href="https://x.test" target="_self">x</a>');
    expect(out).toBe('<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it("keeps the contents of unknown-but-harmless tags", () => {
    expect(sanitizeFooterHtml("<section><font size=7>PTO</font></section>")).toBe("PTO");
  });

  it("balances tags so a footer can't swallow the page", () => {
    expect(sanitizeFooterHtml("<div><p>hi")).toBe("<div><p>hi</p></div>");
    // A close tag that opened nothing is dropped rather than closing an ancestor.
    expect(sanitizeFooterHtml("<div>a</span>b</div>")).toBe("<div>ab</div>");
    // Crossed nesting closes the inner element rather than leaving it open.
    expect(sanitizeFooterHtml("<em><strong>x</em></strong>")).toBe("<em><strong>x</strong></em>");
  });

  it("escapes a stray angle bracket that didn't parse as a tag", () => {
    expect(sanitizeFooterHtml("5 < 6 & 7 > 2")).toBe("5 &lt; 6 & 7 > 2");
    expect(sanitizeFooterHtml("<p>a<!-- comment -->b</p>")).toBe("<p>ab</p>");
  });

  it("returns an empty string for anything unusable", () => {
    expect(sanitizeFooterHtml(null)).toBe("");
    expect(sanitizeFooterHtml("   ")).toBe("");
    expect(sanitizeFooterHtml(42)).toBe("");
  });

  it("caps how much markup one setting can inject", () => {
    expect(sanitizeFooterHtml("x".repeat(50_000)).length).toBeLessThanOrEqual(20_000);
  });
});

describe("footer selection", () => {
  const branding = (footerHtml: string) => ({
    newsletterTitle: "T",
    accentColor: "#0068A8",
    logoUrl: null,
    footerHtml,
  });

  it("passes the stored markup through untouched", () => {
    expect(footerHtmlOf(branding("<p>rich</p>"))).toBe("<p>rich</p>");
    expect(footerHtmlOf(branding(""))).toBe("");
  });

  it("flattens the HTML footer for the text part", () => {
    expect(footerTextOf(branding("<p>rich</p>"))).toBe("rich");
    expect(footerTextOf(branding(""))).toBe("");
  });

  it("reaches the email as markup, not as escaped text", () => {
    const html = renderNewsletterEmailHtml({
      // What's stored is what the sanitizer produced, so that's what's rendered.
      branding: branding(sanitizeFooterHtml('<p><a href="https://x.test">Board</a></p>')),
      title: "Issue",
      subtitle: null,
      doc: doc(para("hello")),
      resolveEvents: NO_EVENTS,
      unsubscribeUrl: "https://x.test/u/1",
      unsubscribeWording: "Done with these?",
      mailingAddress: "1 Main St",
      webUrl: "https://x.test/n/issue",
    });
    expect(html).toContain('<a href="https://x.test" target="_blank" rel="noopener noreferrer">Board</a>');
    expect(html).not.toContain("&lt;p&gt;");
  });
});

describe("settings coercion", () => {
  const base = {
    senderName: "Base",
    senderEmail: "base@x.test",
    replyTo: null,
    footerHtml: "<p>footer</p>",
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

  it("stores the footer HTML already sanitized", () => {
    const out = coerceNewsletterSettings(
      { footerHtml: '<p>Sent by the PTO</p><script>alert(1)</script>' },
      base,
    );
    expect(out.footerHtml).toBe("<p>Sent by the PTO</p>");
  });

  it("promotes a pre-HTML footerText so an existing footer isn't blanked", () => {
    const out = coerceNewsletterSettings({ footerText: "Sent by the PTO & friends" }, base);
    expect(out.footerHtml).toBe("<p>Sent by the PTO &amp; friends</p>");
  });

  it("prefers stored HTML over a leftover footerText", () => {
    const out = coerceNewsletterSettings(
      { footerText: "old wording", footerHtml: "<p>new</p>" },
      base,
    );
    expect(out.footerHtml).toBe("<p>new</p>");
  });

  it("lets an admin clear the footer instead of resurrecting the default", () => {
    expect(coerceNewsletterSettings({ footerHtml: "" }, base).footerHtml).toBe("");
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
