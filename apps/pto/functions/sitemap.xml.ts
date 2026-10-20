// GET /sitemap.xml
//
// Each public page, with an hreflang alternate for each locale — the same set
// functions/_lib/page.ts writes into the head, listed here so a crawler finds
// the translated variants without having to discover them. Adding a locale to
// LOCALES extends both for free.
//
// Static, unlike the store's, which is driven from the live catalog: the
// public pages here are the two below and no data could add another. Nothing
// to degrade, so nothing degrades. A page added to `functions/` and not to
// PUBLIC_PATHS is a page no search engine hears about — the same rule
// INDEXED_PATHS enforces on apps/home.

import { LOCALES } from "@sd/shared";
import { LANG_PARAM } from "./_lib/locale.js";
import { escapeHtml } from "./_lib/page.js";

const PUBLIC_PATHS = ["/", "/how-to-help"];

export const onRequestGet: PagesFunction = ({ request }) => {
  const origin = new URL(request.url).origin;

  const urls = PUBLIC_PATHS.map((path) => {
    const loc = `${origin}${path}`;
    const alternates = LOCALES.map(
      (l) =>
        `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeHtml(
          `${loc}?${LANG_PARAM}=${l}`,
        )}" />`,
    ).join("\n");
    return `  <url>
    <loc>${escapeHtml(loc)}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(loc)}" />
  </url>`;
  }).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>
`;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
};
