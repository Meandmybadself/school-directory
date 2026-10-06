// Turning what an author highlighted, or typed into the link prompt, into an
// href. Kept apart from the editor so it can be tested without a DOM editor.

/** A web address as people actually write one: an optional http(s) scheme, a
 *  dotted host ending in a letters-only TLD, an optional port, then anything up
 *  to the first space. No `@` before the path, so `pto@example.org` — an
 *  address, not a site — is not mistaken for one. */
const WEB_ADDRESS =
  /^(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;

/** The href for highlighted text that is itself a web address, or null when it
 *  isn't one. A missing scheme becomes https. Trailing sentence punctuation is
 *  left out of the href, since "Sign up at example.org." ends a sentence, not
 *  the address. */
export function urlFromSelection(text: string): string | null {
  const t = text.trim().replace(/[.,;:!?]+$/, "");
  if (!t || !WEB_ADDRESS.test(t)) return null;
  return withScheme(t);
}

/** An href from what was typed into the link prompt. A bare domain is what
 *  people type; without a scheme the renderer would drop the mark as unsafe,
 *  so it gets https rather than silently losing the link. */
export function withScheme(url: string): string {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
}
