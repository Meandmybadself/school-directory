// The printed QR code (packages/shared/src/newsletterQr.ts).
//
// The guarantee worth pinning is the refusal: a printed copy is the most
// redistributed form of an issue, so a review-token url must never be drawn
// into one (invariant 15). Everything else is layout.

import { describe, expect, it } from "vitest";
import {
  isPublishedIssueUrl,
  LOCALES,
  localeNames,
  linkQrSvg,
  NEWSLETTER_WEB_CSS,
  publishedIssueQrSvg,
  renderNewsletterBodyHtml,
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
    expect(page(URL_OK)).toContain('class="nl-qr ');
    expect(page("")).not.toContain("nl-qr");
  });

  it("lists every language but English beneath the code, in LOCALES order", () => {
    const qr = page(URL_OK).match(/<div class="nl-qr[^]*?<\/div>/)![0];
    const langs = [...qr.matchAll(/<p lang="(\w+)">([^<]*)<\/p>/g)];
    const others = LOCALES.filter((l) => l !== "en");
    expect(langs.map((m) => m[1])).toEqual(others);
    expect(langs.map((m) => m[2])).toEqual(others.map((l) => localeNames[l].native));
    expect(qr).not.toContain("English");
    expect(qr).not.toContain("Scan");
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

describe("a printed QR code beside each link in the body", () => {
  const link = (text: string, href: string, extra: { type: string }[] = []) => ({
    type: "text",
    text,
    marks: [...extra, { type: "link", attrs: { href } }],
  });
  const render = (mode: "web" | "email", content: unknown[]) =>
    renderNewsletterBodyHtml({ type: "doc", content } as NewsletterNode, () => [], { mode });
  const body = (mode: "web" | "email", ...inline: unknown[]) =>
    render(mode, [{ type: "paragraph", content: inline }]);
  const codes = (html: string) => (html.match(/<svg /g) ?? []).length;

  it("puts the code in a column at the top of the paragraph holding the link", () => {
    const html = body("web", { type: "text", text: "Sign up " }, link("here", "https://www.signupgenius.com/go/abc"));
    expect(html).toMatch(
      /^<p class="nl-p"><span class="nl-qr-col" aria-hidden="true"><span class="nl-qr-item"><span class="nl-qr-num">1<\/span><svg [^]*<\/svg><\/span><\/span>Sign up <a href="https:\/\/www\.signupgenius\.com\/go\/abc"/,
    );
  });

  it("marks each link with a superscript number matching the one beside its code", () => {
    const html = body("web", link("a", "https://example.org/a"), { type: "text", text: " and " }, link("b", "https://example.org/b"));
    expect(html).toContain('<span class="nl-qr-num">1</span>');
    expect(html).toContain('<span class="nl-qr-num">2</span>');
    expect(html).toContain('>a</a><sup class="nl-qr-ref">1</sup> and ');
    expect(html).toMatch(/>b<\/a><sup class="nl-qr-ref">2<\/sup><\/p>$/);
  });

  it("puts one superscript after a split link, and reuses the number when the link repeats", () => {
    const html = render("web", [
      { type: "paragraph", content: [link("Book ", "https://example.org/fair"), link("fair", "https://example.org/fair", [{ type: "bold" }])] },
      { type: "paragraph", content: [link("again", "https://example.org/fair")] },
    ]);
    expect((html.match(/nl-qr-ref/g) ?? []).length).toBe(2);
    expect(html).toContain('>Book </a><a href="https://example.org/fair"');
    expect(html).toContain('<strong>fair</strong></a><sup class="nl-qr-ref">1</sup>');
    expect(html).toContain('>again</a><sup class="nl-qr-ref">1</sup>');
  });

  it("puts no superscript on a link that gets no code", () => {
    expect(body("web", link("Call", "tel:+16125550100"))).not.toContain("<sup");
    expect(body("email", link("here", "https://example.org/x"))).not.toContain("<sup");
  });

  it("carries no caption, only the code", () => {
    const html = body("web", link("here", "https://www.signupgenius.com/go/abc"));
    expect(html).not.toContain("signupgenius.com</span>");
  });

  it("gives a block holding codes no class of its own, so it is laid out like any other", () => {
    const html = body("web", link("a", "https://example.org/a"), link("b", "https://example.org/b"));
    expect(html).toMatch(/^<p class="nl-p"><span class="nl-qr-col"/);
    expect(codes(html)).toBe(2);
  });

  it("places a list item's code on the item, not the list", () => {
    const html = render("web", [
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [link("menu", "https://example.org/menu")] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] },
      ] },
    ]);
    expect(html).toMatch(/<li class="nl-li"><span class="nl-qr-col"/);
    expect(html).toContain('<li class="nl-li">plain</li>');
  });

  it("never reaches the email, which can't hide it on screen", () => {
    const html = body("email", link("here", "https://example.org/x"));
    expect(html).not.toContain("nl-qr");
    expect(html).not.toContain("<svg");
  });

  it("draws one code per destination, however the link text is split", () => {
    // A partly-bold link arrives as two text nodes with one href.
    const html = render("web", [
      { type: "paragraph", content: [link("Book ", "https://example.org/fair"), link("fair", "https://example.org/fair", [{ type: "bold" }])] },
      { type: "paragraph", content: [link("again", "https://example.org/fair"), link("menu", "https://example.org/menu")] },
    ]);
    expect(codes(html)).toBe(2);
    expect((html.match(/class="nl-qr-col"/g) ?? []).length).toBe(2);
  });

  it("draws one for a mailto link, which a phone opens as a new message", () => {
    expect(body("web", link("Email us", "mailto:pto@example.org"))).toContain('class="nl-qr-col"');
    expect(linkQrSvg("mailto:pto@example.org?subject=Book%20fair")).toMatch(/^<svg /);
  });

  it("skips anything else: tel, and a mailto with no address", () => {
    expect(body("web", link("Call", "tel:+16125550100"))).not.toContain("nl-qr");
    expect(linkQrSvg("mailto:")).toBe("");
    expect(linkQrSvg("mailto:nobody")).toBe("");
  });

  it("is hidden on screen, and on paper floats into a rail the body reserves", () => {
    const printAt = NEWSLETTER_WEB_CSS.indexOf("@media print");
    const screen = NEWSLETTER_WEB_CSS.slice(0, printAt);
    const print = NEWSLETTER_WEB_CSS.slice(printAt);
    expect(screen).toContain(".nl-qr-col{display:none}");
    expect(screen).toContain(".nl-qr-ref{display:none}");
    expect(screen).not.toContain(".nl-body-rail");
    const rail = print.match(/\.nl-body-rail\{padding-right:([\d.]+)in\}/);
    expect(rail).not.toBeNull();
    // The column's negative margin must equal the rail, or it intrudes on the
    // text (smaller) or hangs off the page (larger).
    expect(print).toMatch(new RegExp(`\\.nl-qr-col\\{[^}]*float:right;clear:right;[^}]*margin:[^;}]* -${rail![1]}in `));
    // Nothing may size a block by its codes again: that is what made blocks
    // with links taller and narrower than the ones without.
    expect(print).not.toMatch(/min-height/);
  });

  it("reserves the rail on the page only when the issue has a code to put in it", () => {
    const page = (content: unknown[]) =>
      renderNewsletterIssuePageHtml({
        branding: BRANDING,
        title: "T",
        subtitle: null,
        doc: { type: "doc", content } as NewsletterNode,
        resolveEvents: () => [],
        dateLabel: "September 1, 2099",
        isDraft: false,
        archiveHref: "",
        printHref: "",
        issueUrl: "",
        publishedUrl: "",
      });
    expect(page([{ type: "paragraph", content: [link("a", "https://example.org/a")] }])).toContain('class="nl-body nl-body-rail"');
    expect(page([{ type: "paragraph", content: [{ type: "text", text: "plain" }] }])).toContain('class="nl-body"');
    expect(page([{ type: "paragraph", content: [link("Call", "tel:+16125550100")] }])).not.toContain("nl-body-rail");
  });
});
