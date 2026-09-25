import { describe, expect, it } from "vitest";
import { linkify } from "./linkify.js";

const links = (s: string) => linkify(s).filter((r) => r.kind !== "text");

describe("linkify", () => {
  it("returns plain text as one run and loses no characters", () => {
    const s = "Bring a water bottle.\nPickup at 3:15.";
    expect(linkify(s)).toEqual([{ kind: "text", text: s }]);
    const mixed = "See https://example.org/a, or call 952-988-5000 (office).";
    expect(linkify(mixed).map((r) => r.text).join("")).toBe(mixed);
  });

  it("links http(s) and bare www URLs, trimming sentence punctuation", () => {
    expect(links("Details: https://example.org/path?q=1.")).toEqual([
      { kind: "url", text: "https://example.org/path?q=1", href: "https://example.org/path?q=1" },
    ]);
    expect(links("(see www.hopkinsschools.org)")).toEqual([
      { kind: "url", text: "www.hopkinsschools.org", href: "https://www.hopkinsschools.org" },
    ]);
    expect(links("https://en.wikipedia.org/wiki/Foo_(bar)")[0]!.text).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("never builds an href from a scheme it did not choose", () => {
    expect(links("javascript:alert(1)")).toEqual([]);
    expect(links("data:text/html,hi")).toEqual([]);
  });

  it("links email addresses as mailto", () => {
    expect(links("Questions? pto@eisenhower.school.")).toEqual([
      { kind: "email", text: "pto@eisenhower.school", href: "mailto:pto@eisenhower.school" },
    ]);
  });

  it("links North American phone numbers in the usual spellings", () => {
    for (const s of ["952-988-5000", "(952) 988-5000", "952.988.5000", "+1 952 988 5000", "9529885000"]) {
      expect(links(`Call ${s} today`)).toEqual([{ kind: "phone", text: s, href: "tel:+19529885000" }]);
    }
  });

  it("does not mistake other digit runs for phone numbers", () => {
    expect(links("Order 1234567890123")).toEqual([]);
    expect(links("Code 952-988-5000-1")).toEqual([]);
    expect(links("id 0123456789")).toEqual([]);
    expect(links("2026-09-25 at 10:30")).toEqual([]);
    // A number inside a URL belongs to the URL.
    expect(links("https://example.org/9529885000")).toHaveLength(1);
    expect(links("https://example.org/9529885000")[0]!.kind).toBe("url");
  });
});
