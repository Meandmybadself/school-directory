// The printed QR code (packages/shared/src/newsletterQr.ts).
//
// The guarantee worth pinning is the refusal: a printed copy is the most
// redistributed form of an issue, so a review-token url must never be drawn
// into one (invariant 15). Everything else is layout.

import { describe, expect, it } from "vitest";
import {
  isPublishedIssueUrl,
  NEWSLETTER_WEB_CSS,
  publishedIssueQrSvg,
  renderNewsletterIssuePageHtml,
} from "@sd/shared";
import type { NewsletterBrandingDTO, NewsletterNode } from "@sd/shared";

const URL_OK = "https://newsletter.eisenhower.school/n/2099-09-01-back-to-school";

const BRANDING: NewsletterBrandingDTO = {
  newsletterTitle: "Eisenhower News",
  accentColor: "#0068A8",
  logoUrl: null,
  footerHtml: "",
  unsubscribeWording: "",
  mailingAddress: "",
  webUrl: null,
} as unknown as NewsletterBrandingDTO;

const DOC: NewsletterNode = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] };

function page(publishedUrl: string) {
  return renderNewsletterIssuePageHtml({
    branding: BRANDING,
    title: "Back to school",
    subtitle: null,
    doc: DOC,
    resolveEvents: () => [],
    dateLabel: "September 1, 2099",
    isDraft: false,
    archiveHref: "",
    printHref: "",
    issueUrl: "",
    publishedUrl,
  });
}

describe("publishedIssueQrSvg", () => {
  it("accepts a sent issue's /n/:slug url, and only that shape", () => {
    expect(isPublishedIssueUrl(URL_OK)).toBe(true);
    expect(isPublishedIssueUrl("http://localhost:8788/n/x")).toBe(true);
    for (const bad of [
      "https://newsletter.eisenhower.school/preview/abc123",
      "https://newsletter.eisenhower.school/preview/abc123/print",
      "https://newsletter.eisenhower.school/n/x/print",
      "https://newsletter.eisenhower.school/n/x?token=abc",
      "https://newsletter.eisenhower.school/n/x#t",
      "/n/x",
      "javascript:alert(1)//n/x",
      "",
    ]) {
      expect(isPublishedIssueUrl(bad), bad).toBe(false);
      expect(publishedIssueQrSvg(bad), bad).toBe("");
    }
  });

  it("draws the three finder squares where a scanner looks for them", () => {
    const svg = publishedIssueQrSvg(URL_OK);
    expect(svg).toMatch(/^<svg /);
    // Re-raster the path into a module grid, so a bug in the run-length drawing
    // fails here rather than on a parent's phone.
    const view = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(svg)!;
    const q = -Number(view[1]);
    expect(q).toBe(4); // the quiet zone the spec requires
    const size = Number(view[3]) - q * 2;
    expect((size - 17) % 4).toBe(0); // a real QR version: 21, 25, 29, …
    const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)/g)) {
      const [x, y, run] = [Number(m[1]), Number(m[2]), Number(m[3])];
      for (let i = 0; i < run; i++) grid[y]![x + i] = true;
    }
    const finder = (ox: number, oy: number) =>
      Array.from({ length: 7 }, (_, y) =>
        Array.from({ length: 7 }, (_, x) => (grid[oy + y]![ox + x] ? "#" : ".")).join(""),
      );
    const want = ["#######", "#.....#", "#.###.#", "#.###.#", "#.###.#", "#.....#", "#######"];
    expect(finder(0, 0)).toEqual(want);
    expect(finder(size - 7, 0)).toEqual(want);
    expect(finder(0, size - 7)).toEqual(want);
  });
});

describe("the issue page's printed QR code", () => {
  it("renders for a published url and not for an empty one", () => {
    expect(page(URL_OK)).toContain('class="nl-qr"');
    expect(page(URL_OK)).toContain("newsletter.eisenhower.school/n/2099-09-01-back-to-school");
    expect(page("")).not.toContain("nl-qr");
  });

  it("refuses a token url even when a caller passes one", () => {
    const html = page("https://newsletter.eisenhower.school/preview/abc123");
    expect(html).not.toContain("nl-qr");
    expect(html).not.toContain("abc123");
  });

  it("is hidden on screen and shown only in print", () => {
    const printAt = NEWSLETTER_WEB_CSS.indexOf("@media print");
    expect(NEWSLETTER_WEB_CSS.slice(0, printAt)).toContain(".nl-qr{display:none}");
    expect(NEWSLETTER_WEB_CSS.slice(printAt)).toMatch(/\.nl-qr\{display:block/);
  });
});
