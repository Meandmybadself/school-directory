// Which editor a stored footer can safely be opened in.
//
// The footer is stored as HTML and sanitized to FOOTER_TAGS (see invariant 9),
// but the rich editor's TipTap schema covers only part of that allowlist. Layout
// tables, <div>/<span> wrappers and anything carrying inline styles are all
// legal in a stored footer and have no node in the editor — loading one into it
// would flatten the markup, and the first keystroke would save the flattened
// version over the admin's work.
//
// So the footer field asks this first and opens in HTML mode when the answer is
// yes. Kept separate from FooterEditor.tsx because it's the load-bearing part
// and worth testing without mounting TipTap.

/** Tags the rich toolbar can round-trip. A strict subset of FOOTER_TAGS. */
const RICH_TAGS = new Set([
  "p", "strong", "b", "em", "i", "s", "a", "br", "hr",
  "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "img",
]);

/** True when the markup contains a tag the rich editor can't represent.
 *  Deliberately errs toward HTML mode: a false positive costs an admin one
 *  click, a false negative costs them their footer. Tag detection only — an
 *  attribute the editor drops (a `style` on a <p>) is a cosmetic loss, not a
 *  structural one, and gating on it would push every styled footer into HTML. */
export function needsHtmlMode(html: string): boolean {
  for (const m of html.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g)) {
    if (!RICH_TAGS.has(m[1]!.toLowerCase())) return true;
  }
  return false;
}
