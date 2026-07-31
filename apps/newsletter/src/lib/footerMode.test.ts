// The gate that decides whether a stored footer is safe to open in the rich
// editor. Getting a "no" wrong is the expensive direction: the editor would
// flatten markup it can't represent and the next keystroke would save it.

import { describe, expect, it } from "vitest";
import { needsHtmlMode } from "./footerMode.js";

describe("needsHtmlMode", () => {
  it("accepts markup the toolbar can round-trip", () => {
    expect(needsHtmlMode("")).toBe(false);
    expect(needsHtmlMode("<p>Sent by the PTO</p>")).toBe(false);
    expect(
      needsHtmlMode('<p><strong>PTO</strong> — <a href="https://x.test">unsubscribe</a></p>'),
    ).toBe(false);
    expect(needsHtmlMode("<ul><li>one</li><li>two</li></ul><hr /><h3>Contact</h3>")).toBe(false);
  });

  it("rejects markup with no node in the editor", () => {
    expect(needsHtmlMode("<table><tr><td>a</td></tr></table>")).toBe(true);
    expect(needsHtmlMode('<div align="center">centered</div>')).toBe(true);
    expect(needsHtmlMode('<p><span style="color:#888">muted</span></p>')).toBe(true);
    // Allowed by the sanitizer, absent from the toolbar.
    expect(needsHtmlMode("<p><small>fine print</small></p>")).toBe(true);
    expect(needsHtmlMode("<p><u>underlined</u></p>")).toBe(true);
  });

  it("ignores tag case and stray whitespace", () => {
    expect(needsHtmlMode("<P>plain</P>")).toBe(false);
    expect(needsHtmlMode("<  TABLE ><tr><td>a</td></tr></  table >")).toBe(true);
  });

  it("doesn't mistake prose for markup", () => {
    // A bare "<" that never becomes a tag shouldn't force HTML mode.
    expect(needsHtmlMode("<p>Doors open &lt; 8am, seats &lt; 40</p>")).toBe(false);
    expect(needsHtmlMode("<p>5 < 6 and 7 > 6</p>")).toBe(false);
  });

  it("catches a closing tag whose opener was already stripped", () => {
    expect(needsHtmlMode("<p>text</p></div>")).toBe(true);
  });
});
