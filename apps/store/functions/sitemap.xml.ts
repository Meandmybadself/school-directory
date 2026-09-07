// GET /sitemap.xml
//
// The storefront and every PUBLISHED product, each with hreflang alternates for
// all four locales — the same set functions/_lib/page.ts writes into the head,
// listed here so a crawler finds the translated variants without having to
// discover them. Adding a locale to LOCALES extends both for free.
//
// Driven from the live catalog rather than a static list, so an unpublished
// product is absent by construction: it comes from `/store-public/products`,
// which filters `published_at IS NOT NULL` in SQL. There is no second place
// here that could disagree with the storefront about what is for sale.
//
// An API failure yields a sitemap with just the storefront in it rather than a
// 500 — the same "degrade to empty" rule the catalog page follows.

import { LOCALES } from "@sd/shared";
import type { PublicStoreProductDTO } from "@sd/shared";
import { apiJson, escapeHtml, type PagesEnv } from "./_lib/page.js";
import { LANG_PARAM } from "./_lib/locale.js";

function entry(origin: string, path: string): string {
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
}

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  const data = await apiJson<{ products: PublicStoreProductDTO[] }>(env, "/store-public/products");
  const paths = ["/", ...(data?.products ?? []).map((p) => `/p/${encodeURIComponent(p.slug)}`)];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${paths.map((p) => entry(origin, p)).join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=900" },
  });
};
