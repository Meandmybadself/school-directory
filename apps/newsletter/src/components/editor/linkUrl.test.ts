// Highlight-to-link: which highlighted text counts as a web address. The
// expensive mistake is a false yes — linking a sentence or an email address to
// a nonsense href without asking — so the refusals matter as much as the hits.

import { describe, expect, it } from "vitest";
import { urlFromSelection, withScheme } from "./linkUrl.js";

describe("urlFromSelection", () => {
  it("links a bare domain or path over https", () => {
    expect(urlFromSelection("example.org")).toBe("https://example.org");
    expect(urlFromSelection("www.signupgenius.com/go/10C0E4BA9AB2CA3FAC07-bookfair")).toBe(
      "https://www.signupgenius.com/go/10C0E4BA9AB2CA3FAC07-bookfair",
    );
    expect(urlFromSelection("calendar.eisenhower.school/e/2026-10-13/book-fair?x=1#top")).toBe(
      "https://calendar.eisenhower.school/e/2026-10-13/book-fair?x=1#top",
    );
  });

  it("keeps a scheme the author typed", () => {
    expect(urlFromSelection("http://example.org/a")).toBe("http://example.org/a");
    expect(urlFromSelection("HTTPS://Example.org")).toBe("HTTPS://Example.org");
  });

  it("ignores surrounding space and sentence punctuation", () => {
    expect(urlFromSelection("  example.org. ")).toBe("https://example.org");
    expect(urlFromSelection("docs.google.com/forms/abc,")).toBe("https://docs.google.com/forms/abc");
  });

  it("refuses text that is not an address", () => {
    for (const text of [
      "",
      "Sign up here",
      "example.org and more",
      "pto@eisenhower.school",
      "mailto:pto@eisenhower.school",
      "localhost",
      "e.g",
      "4.30",
      "ftp://example.org",
      "javascript:alert(1)",
    ]) {
      expect(urlFromSelection(text), text).toBeNull();
    }
  });
});

describe("withScheme", () => {
  it("adds https to a bare domain and leaves http, https and mailto alone", () => {
    expect(withScheme("example.org")).toBe("https://example.org");
    expect(withScheme("http://example.org")).toBe("http://example.org");
    expect(withScheme("mailto:pto@example.org")).toBe("mailto:pto@example.org");
  });
});
