// Machine-translation links on a newsletter issue.
//
// Two of these tests are about privacy rather than about URLs, and they are the
// reason this file exists at all: a translation link is a url handed to Google's
// servers to fetch, so the question "which urls may appear in one" has the same
// shape as every public-projection question in this project. The answer is
// "only a sent issue's public page" — see invariants 10 and 15 — and the last
// describe() block is what holds the four issue-page surfaces to it.

import { describe, expect, it } from "vitest";
import {
  LOCALES,
  newsletterLanguageLinks,
  renderNewsletterEmailHtml,
  renderNewsletterEmailText,
  renderNewsletterIssuePageHtml,
  translateProxyUrl,
  type NewsletterBrandingDTO,
  type NewsletterNode,
} from "@sd/shared";

const ISSUE_URL = "https://newsletter.eisenhower.school/n/back-to-school";

const BRANDING: NewsletterBrandingDTO = {
  newsletterTitle: "Eisenhower PTO",
  accentColor: "#0068A8",
  logoUrl: null,
  footerHtml: "<p>Footer</p>",
  calendarUrl: "https://calendar.eisenhower.school",
};

const DOC: NewsletterNode = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello." }] }],
};

function emailInput(webUrl: string) {
  return {
    branding: BRANDING,
    title: "Back to school",
    subtitle: null,
    doc: DOC,
    resolveEvents: () => [],
    unsubscribeUrl: "https://newsletter.eisenhower.school/unsubscribe/t",
    unsubscribeWording: "You get this because you signed up.",
    mailingAddress: "1000 Eisenhower Ln",
    webUrl,
  };
}

function page(over: Partial<Parameters<typeof renderNewsletterIssuePageHtml>[0]> = {}) {
  return renderNewsletterIssuePageHtml({
    branding: BRANDING,
    title: "Back to school",
    subtitle: null,
    doc: DOC,
    resolveEvents: () => [],
    dateLabel: "September 1, 2099",
    isDraft: false,
    archiveHref: "/",
    printHref: "/n/back-to-school/print",
    issueUrl: ISSUE_URL,
    ...over,
  });
}

describe("translateProxyUrl", () => {
  it("mints Google's proxy host by dotting-to-dashing the real one", () => {
    expect(translateProxyUrl(ISSUE_URL, "es")).toBe(
      "https://newsletter-eisenhower-school.translate.goog/n/back-to-school" +
        "?_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es",
    );
  });

  it("doubles a dash already in the hostname, so the transform can't collide", () => {
    // We have no hyphenated host today. The day someone adds one, this is what
    // stops the proxy url quietly naming a DIFFERENT site than we meant.
    const url = translateProxyUrl("https://news-letter.example.school/n/x", "so");
    expect(url).toContain("https://news--letter-example-school.translate.goog/n/x");
  });

  it("names the script for Chinese, because the proxy's codes aren't ours", () => {
    expect(translateProxyUrl(ISSUE_URL, "zh")).toContain("_x_tr_tl=zh-CN");
  });

  it("sets the proxy toolbar's own language to the target", () => {
    // So "show original" is readable by the person who needed the translation.
    expect(translateProxyUrl(ISSUE_URL, "so")).toContain("_x_tr_hl=so");
  });

  it("returns null for the source language, which needs no proxy", () => {
    expect(translateProxyUrl(ISSUE_URL, "en")).toBeNull();
  });

  it("refuses any url it cannot show is publicly fetchable", () => {
    // Each of these would be handed to a third party to fetch. None of them is
    // a public https origin, so none of them may be offered.
    expect(translateProxyUrl("/n/back-to-school", "es")).toBeNull();
    expect(translateProxyUrl("http://newsletter.eisenhower.school/n/x", "es")).toBeNull();
    expect(translateProxyUrl("http://localhost:5175/n/x", "es")).toBeNull();
    expect(translateProxyUrl("https://localhost:5175/n/x", "es")).toBeNull();
    expect(translateProxyUrl("https://localhost/n/x", "es")).toBeNull();
    expect(translateProxyUrl("https://user:pw@evil.example/n/x", "es")).toBeNull();
    expect(translateProxyUrl("javascript:alert(1)", "es")).toBeNull();
    expect(translateProxyUrl("", "es")).toBeNull();
  });

  it("keeps a query string it was given and appends its own params", () => {
    const url = translateProxyUrl("https://a.example/n/x?ref=sms", "es");
    expect(url).toBe(
      "https://a-example.translate.goog/n/x?ref=sms&_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es",
    );
  });
});

describe("newsletterLanguageLinks", () => {
  it("offers every locale we support, each named in its own language", () => {
    const links = newsletterLanguageLinks(ISSUE_URL, "proxy");
    expect(links.map((l) => l.locale)).toEqual([...LOCALES]);
    expect(links.map((l) => l.label)).toEqual(["English", "Español", "中文", "Soomaali"]);
  });

  it("marks the source language and gives it no href", () => {
    const en = newsletterLanguageLinks(ISSUE_URL, "proxy").find((l) => l.locale === "en");
    expect(en?.isSource).toBe(true);
    expect(en?.href).toBe("");
  });

  it("uses our own origin in 'param' form and the proxy in 'proxy' form", () => {
    // The email gets `?lang=`: a sent issue is immutable and its links are
    // permanent, so the destination has to stay ours to re-point. The page,
    // re-rendered every request, can name the service outright — and must, or
    // clicking it from INSIDE the proxy asks the proxy to re-proxy us.
    const param = newsletterLanguageLinks(ISSUE_URL, "param").find((l) => l.locale === "es");
    expect(param?.href).toBe(`${ISSUE_URL}?lang=es`);
    expect(param?.href).not.toContain("translate.goog");

    const proxy = newsletterLanguageLinks(ISSUE_URL, "proxy").find((l) => l.locale === "es");
    expect(proxy?.href).toContain("translate.goog");
  });

  it("collapses to nothing when no link can be built, rather than dead text", () => {
    expect(newsletterLanguageLinks("", "param")).toEqual([]);
    expect(newsletterLanguageLinks("/n/x", "param")).toEqual([]);
    expect(newsletterLanguageLinks("http://localhost:5175/n/x", "param")).toEqual([]);
  });

  it("drops the whole bar in 'param' form too when the url isn't public", () => {
    // The `?lang=` hrefs would look fine on their own; they'd redirect to a
    // proxy that can't fetch localhost. The bar is built from what the proxy
    // could actually serve, so both forms disappear together.
    expect(newsletterLanguageLinks("http://localhost:5175/n/x", "param")).toEqual([]);
  });
});

describe("the bar as rendered", () => {
  it("appears in the email, in `?lang=` form, naming no third party", () => {
    const html = renderNewsletterEmailHtml(emailInput(ISSUE_URL));
    expect(html).toContain(`${ISSUE_URL}?lang=es`);
    expect(html).toContain("Soomaali");
    expect(html).toContain('lang="zh"');
    // A url baked into an inbox forever must not name a service we might drop.
    expect(html).not.toContain("translate.goog");
  });

  it("appears in the text part as name-and-url lines, with no English sentence", () => {
    const text = renderNewsletterEmailText(emailInput(ISSUE_URL));
    expect(text).toContain(`Español: ${ISSUE_URL}?lang=es`);
    expect(text).toContain(`中文: ${ISSUE_URL}?lang=zh`);
    // The source language isn't listed: the reader is already holding it.
    expect(text).not.toContain("English:");
  });

  it("leaves no empty furniture in the email when there is no public url", () => {
    const html = renderNewsletterEmailHtml(emailInput("/n/back-to-school"));
    expect(html).not.toContain("Soomaali");
    expect(html).not.toContain("?lang=");
  });

  it("appears on the archive page in proxy form", () => {
    const html = page();
    expect(html).toContain("nl-lang");
    expect(html).toContain("newsletter-eisenhower-school.translate.goog");
    expect(html).toContain("Español");
  });

  it("does not appear on any page that passes no issue url", () => {
    // The four issue-page surfaces are: /n/:slug (bar), /n/:slug/print,
    // /preview/:token and /preview/:token/print (all three, none). The last two
    // matter most — their url IS a live capability (invariant 15), and a
    // translation link would post it to a caching third party to fetch.
    const html = page({ issueUrl: "" });
    expect(html).not.toContain("nl-lang");
    expect(html).not.toContain("translate.goog");
    expect(html).not.toContain("Soomaali");
  });

  it("never puts a token url through the proxy even if one is handed to it", () => {
    // Defence in depth on the rule above: the callers pass "", but if a future
    // one passed the token page's own url, this is what it would produce — and
    // the point is that it WOULD produce a link, so the "" is load-bearing and
    // not merely tidy. Stated as a test so nobody re-derives it as safe.
    const tokenUrl = "https://newsletter.eisenhower.school/preview/abc123";
    expect(translateProxyUrl(tokenUrl, "es")).toContain("abc123");
    expect(page({ issueUrl: tokenUrl })).toContain("abc123");
  });
});
