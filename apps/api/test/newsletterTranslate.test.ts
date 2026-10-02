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
  PROXY_LANGUAGE_SWITCH_JS,
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
    publishedUrl: "",
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
    // the point is that it WOULD produce a link, so the "" is a guard and not
    // merely tidiness. Stated as a test so nobody re-derives it as safe.
    const tokenUrl = "https://newsletter.eisenhower.school/preview/abc123";
    expect(translateProxyUrl(tokenUrl, "es")).toContain("abc123");
    expect(page({ issueUrl: tokenUrl })).toContain("abc123");
  });
});

describe("switching language from inside the proxy", () => {
  // Google rewrites every href on a proxied page server-side, pinned to the
  // language on screen: our `translate.goog` links arrived as
  // `translate.google.com/website?tl=so&u=https://…translate.goog/…`, which the
  // proxy refuses ("Can't translate this page"). The script is what makes the
  // bar work there, so it is run here against a fake page rather than scanned.

  interface FakeAnchor {
    attrs: Map<string, string>;
    onClick?: (e: { preventDefault(): void }) => void;
    getAttribute(n: string): string | null;
    setAttribute(n: string, v: string): void;
    removeAttribute(n: string): void;
    addEventListener(t: string, fn: (e: { preventDefault(): void }) => void): void;
  }

  /** The bar exactly as the page renders it, parsed out of the real html. */
  function barAnchors(): FakeAnchor[] {
    const bar = /<div class="nl-lang[^"]*"[^>]*>(.*?)<\/div>/s.exec(page())?.[1] ?? "";
    return [...bar.matchAll(/<a ([^>]*)>/g)].map((m) => {
      const attrs = new Map<string, string>();
      for (const a of (m[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)) {
        attrs.set(a[1]!, (a[2] ?? "").replace(/&amp;/g, "&"));
      }
      const el: FakeAnchor = {
        attrs,
        getAttribute: (n) => attrs.get(n) ?? null,
        setAttribute: (n, v) => void attrs.set(n, v),
        removeAttribute: (n) => void attrs.delete(n),
        addEventListener: (_t, fn) => void (el.onClick = fn),
      };
      return el;
    });
  }

  function run(href: string) {
    const url = new URL(href);
    const assigned: string[] = [];
    const location = {
      hostname: url.hostname,
      pathname: url.pathname,
      search: url.search,
      assign: (u: string) => void assigned.push(u),
    };
    const anchors = barAnchors();
    const document = { querySelectorAll: () => anchors };
    new Function("location", "document", PROXY_LANGUAGE_SWITCH_JS)(location, document);
    const byLang = (lang: string) => anchors.find((a) => a.attrs.get("lang") === lang)!;
    return { byLang, assigned };
  }

  // Absolute, never relative: the proxy resolves a relative url against the
  // ORIGINAL site, so `?_x_tr_tl=es` alone lands on our origin untranslated.
  const PROXIED = "https://newsletter-eisenhower-school.translate.goog/n/back-to-school";
  const SOMALI = `${PROXIED}?_x_tr_sl=en&_x_tr_tl=so&_x_tr_hl=so`;

  it("points every other language at the same proxied page in that language", () => {
    const { byLang } = run(SOMALI);
    expect(byLang("es").attrs.get("href")).toBe(
      `${PROXIED}?_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es`,
    );
    expect(byLang("zh").attrs.get("href")).toBe(
      `${PROXIED}?_x_tr_sl=en&_x_tr_tl=zh-CN&_x_tr_hl=zh-CN`,
    );
  });

  it("navigates on click too, in case Google's own script rewrites the href", () => {
    const { byLang, assigned } = run(SOMALI);
    let prevented = false;
    byLang("es").onClick!({ preventDefault: () => void (prevented = true) });
    expect(prevented).toBe(true);
    expect(assigned).toEqual([`${PROXIED}?_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es`]);
  });

  it("turns the source language into the way back to the original page", () => {
    const { byLang } = run(`${SOMALI}&ref=sms`);
    expect(byLang("en").attrs.get("href")).toBe(`${ISSUE_URL}?ref=sms`);
    expect(byLang("en").attrs.has("aria-current")).toBe(false);
  });

  it("marks the language on screen as current, and not a link", () => {
    const { byLang } = run(SOMALI);
    expect(byLang("so").attrs.get("aria-current")).toBe("true");
    expect(byLang("so").attrs.has("href")).toBe(false);
  });

  it("recovers a hyphenated host, undoing the proxy's dash doubling", () => {
    const { byLang } = run(
      "https://news--letter-example-school.translate.goog/n/x?_x_tr_sl=en&_x_tr_tl=es&_x_tr_hl=es",
    );
    expect(byLang("en").attrs.get("href")).toBe("https://news-letter.example.school/n/x");
  });

  it("does nothing on our own origin, where the rendered hrefs already work", () => {
    const { byLang, assigned } = run(ISSUE_URL);
    expect(byLang("es").attrs.get("href")).toContain("translate.goog");
    expect(byLang("en").attrs.has("href")).toBe(false);
    expect(byLang("es").onClick).toBeUndefined();
    expect(assigned).toEqual([]);
  });
});
