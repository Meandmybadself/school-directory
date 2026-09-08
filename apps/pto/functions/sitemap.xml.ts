// GET /sitemap.xml
//
// One page, with an hreflang alternate for each locale — the same set
// functions/_lib/page.ts writes into the head, listed here so a crawler finds
// the translated variants without having to discover them. Adding a locale to
// LOCALES extends both for free.
//
// Static, unlike the store's, which is driven from the live catalog: there is
// exactly one public page here and no data that could add another. Nothing to
// degrade, so nothing degrades.

import { LOCALES } from "@sd/shared";
import { LANG_PARAM } from "./_lib/locale.js";
import { escapeHtml } from "./_lib/page.js";

export const onRequestGet: PagesFunction = ({ request }) => {
  const origin = new URL(request.url).origin;
  const loc = `${origin}/`;
  const alternates = LOCALES.map(
    (l) =>
      `    <xhtml:link rel="alternate" hreflang="${l}" href="${escapeHtml(
        `${loc}?${LANG_PARAM}=${l}`,
      )}" />`,
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>${escapeHtml(loc)}</loc>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeHtml(loc)}" />
  </url>
</urlset>
`;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
};
