// RSS 2.0 for the public newsletter archive.
//
// A feed is the archive index in another encoding, so it is built from the SAME
// inputs the archive page reads — the `PublicNewsletterIssueSummaryDTO` list
// that `/newsletter-public/issues` serves. Nothing here fetches, joins or
// widens: whatever the public archive endpoint withholds (invariant 15's
// projection, the `published_at IS NOT NULL` gate in SQL), this withholds by
// construction, because it never sees anything else. Do not point this at a
// wider DTO to enrich an item.
//
// Items carry the summary — title, date, subtitle-or-excerpt — and LINK to
// `/n/:slug` rather than embedding the issue's HTML. That keeps invariant 9
// intact (one renderer; a feed carrying its own rendering of the body would be
// a second place for an issue's look to drift from the email) and keeps the
// feed small enough to poll politely. The reader's click lands on the page that
// keeps up, the same trade the printed QR code makes.
//
// Only absolute URLs: a feed is read far from the origin that served it, so a
// relative href means nothing to an RSS reader.

import type { NewsletterBrandingDTO, PublicNewsletterIssueSummaryDTO } from "./types.js";
import { escapeHtml } from "./newsletterRender.js";

export interface NewsletterRssInput {
  /** The newsletter site's origin, e.g. "https://newsletter.eisenhower.school". */
  origin: string;
  branding: NewsletterBrandingDTO;
  /** Published issues, newest first — the order the archive endpoint returns. */
  issues: PublicNewsletterIssueSummaryDTO[];
}

/** RFC 822-style date, which is what RSS 2.0 specifies for pubDate.
 *  `toUTCString` emits the RFC 1123 refinement ("Mon, 13 Oct 2025 14:00:00
 *  GMT"), which every feed reader accepts. An unparseable timestamp yields ""
 *  and the element is omitted — a missing pubDate is valid RSS, a garbage one
 *  is not. */
function rssDate(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? "" : new Date(ms).toUTCString();
}

function item(origin: string, issue: PublicNewsletterIssueSummaryDTO): string {
  const link = `${origin}/n/${encodeURIComponent(issue.slug)}`;
  const date = rssDate(issue.publishedAt);
  return [
    "    <item>",
    `      <title>${escapeHtml(issue.title)}</title>`,
    `      <link>${escapeHtml(link)}</link>`,
    // The permanent archive URL is the identity an issue has (invariant 10:
    // slugs are locked once published), so it is the guid too.
    `      <guid isPermaLink="true">${escapeHtml(link)}</guid>`,
    date ? `      <pubDate>${date}</pubDate>` : "",
    `      <description>${escapeHtml(issue.subtitle ?? issue.excerpt)}</description>`,
    "    </item>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The whole feed document. Pure over its input, so the test can pin the shape
 *  without a fetch — the Pages Function at /rss.xml is a thin caller. */
export function renderNewsletterRssXml(input: NewsletterRssInput): string {
  const { origin, branding, issues } = input;
  const self = `${origin}/rss.xml`;
  // Newest first is the endpoint's contract, so the first issue's date is the
  // build date; an empty archive simply omits the element.
  const newest = issues[0] ? rssDate(issues[0].publishedAt) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeHtml(branding.newsletterTitle)}</title>
    <link>${escapeHtml(`${origin}/`)}</link>
    <description>${escapeHtml(`Past issues of the ${branding.newsletterTitle}.`)}</description>
    <language>en</language>
    <atom:link href="${escapeHtml(self)}" rel="self" type="application/rss+xml" />
${newest ? `    <lastBuildDate>${newest}</lastBuildDate>\n` : ""}${issues.map((i) => item(origin, i)).join("\n")}
  </channel>
</rss>
`;
}
