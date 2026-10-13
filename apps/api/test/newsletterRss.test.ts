// The RSS feed (packages/shared/src/newsletterRss.ts).
//
// The feed is the public archive in another encoding, so what matters is that
// it stays exactly that: built from the archive endpoint's own summaries, items
// linking to /n/:slug rather than embedding a second rendering of the body
// (invariant 9), and every piece of text escaped — an issue title is
// member-authored and "Bake sale <3 & more" must not break the document.

import { describe, expect, it } from "vitest";
import { renderNewsletterRssXml } from "@sd/shared";
import type { NewsletterBrandingDTO, PublicNewsletterIssueSummaryDTO } from "@sd/shared";

const ORIGIN = "https://newsletter.eisenhower.school";

const BRANDING: NewsletterBrandingDTO = {
  newsletterTitle: "Eisenhower News & Notes",
  accentColor: "#0068A8",
  logoUrl: null,
  footerHtml: "",
  calendarUrl: "",
} as unknown as NewsletterBrandingDTO;

const WEEK_TWO: PublicNewsletterIssueSummaryDTO = {
  slug: "2099-09-08-week-two",
  title: "Week two <already>",
  subtitle: null,
  publishedAt: "2099-09-08T14:00:00.000Z",
  excerpt: "Picture day is coming & here is what to know.",
};

const ISSUES: PublicNewsletterIssueSummaryDTO[] = [
  WEEK_TWO,
  {
    slug: "2099-09-01-back-to-school",
    title: "Back to school",
    subtitle: "Bell times, bus routes & the first PTO meeting",
    publishedAt: "2099-09-01T14:00:00.000Z",
    excerpt: "Welcome back! This excerpt loses to the subtitle.",
  },
];

const feed = (issues = ISSUES) => renderNewsletterRssXml({ origin: ORIGIN, branding: BRANDING, issues });

describe("renderNewsletterRssXml", () => {
  it("is an RSS 2.0 document naming the newsletter and the archive", () => {
    const xml = feed();
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<rss version="2\.0"/);
    expect(xml).toContain("<title>Eisenhower News &amp; Notes</title>");
    expect(xml).toContain(`<link>${ORIGIN}/</link>`);
    expect(xml).toContain(
      `<atom:link href="${ORIGIN}/rss.xml" rel="self" type="application/rss+xml" />`,
    );
  });

  it("links each item to its permanent /n/:slug page, which is also the guid", () => {
    const xml = feed();
    const url = `${ORIGIN}/n/2099-09-01-back-to-school`;
    expect(xml).toContain(`<link>${url}</link>`);
    expect(xml).toContain(`<guid isPermaLink="true">${url}</guid>`);
    // Items carry the summary, never a rendering of the body: one renderer
    // (invariant 9) means the page is where an issue is read.
    expect(xml).not.toContain("<content:encoded");
  });

  it("describes an issue by its subtitle, falling back to the excerpt", () => {
    const xml = feed();
    expect(xml).toContain("<description>Bell times, bus routes &amp; the first PTO meeting</description>");
    expect(xml).toContain("<description>Picture day is coming &amp; here is what to know.</description>");
    expect(xml).not.toContain("This excerpt loses to the subtitle");
  });

  it("escapes member-authored text rather than trusting it", () => {
    const xml = feed();
    expect(xml).toContain("<title>Week two &lt;already&gt;</title>");
    expect(xml).not.toContain("<already>");
  });

  it("dates items in the RFC 822 form RSS requires, newest first as lastBuildDate", () => {
    const xml = feed();
    expect(xml).toContain("<pubDate>Tue, 08 Sep 2099 14:00:00 GMT</pubDate>");
    expect(xml).toContain("<pubDate>Tue, 01 Sep 2099 14:00:00 GMT</pubDate>");
    expect(xml).toContain("<lastBuildDate>Tue, 08 Sep 2099 14:00:00 GMT</lastBuildDate>");
  });

  it("omits a pubDate it cannot parse rather than emitting garbage", () => {
    const xml = feed([{ ...WEEK_TWO, publishedAt: "not a date" }]);
    expect(xml).not.toContain("<pubDate>");
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).not.toContain("Invalid Date");
  });

  it("renders an empty archive as a valid, empty channel — the API-down shape", () => {
    const xml = feed([]);
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("<lastBuildDate>");
  });

  it("carries only the summary fields, so a widened DTO cannot ride through", () => {
    // The input type is the archive summary; this pins that nothing beyond its
    // five fields reaches the document even if a caller hands a wider object.
    const widened = {
      ...WEEK_TWO,
      previewToken: "tok_SECRET",
      content_json: '{"leak":true}',
    } as PublicNewsletterIssueSummaryDTO;
    const xml = feed([widened]);
    expect(xml).not.toContain("SECRET");
    expect(xml).not.toContain("leak");
  });
});
