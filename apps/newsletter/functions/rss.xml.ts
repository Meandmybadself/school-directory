// GET /rss.xml — the public archive as an RSS 2.0 feed.
//
// Same posture as the archive index one directory up: it reads the public
// `/newsletter-public/issues` endpoint (published issues only — the
// `published_at IS NOT NULL` gate lives in that route's SQL) and renders it,
// here as XML instead of HTML. The document itself is built by
// `renderNewsletterRssXml` in @sd/shared so its shape is pinned by a test
// without a fetch; this file only plumbs the request through.
//
// An API failure degrades to a valid, empty feed rather than a 500 — the rule
// the archive index and the store's sitemap both follow. A reader polling the
// feed during an outage sees "no items", not an error it might cache or
// unsubscribe over.

import { renderNewsletterRssXml } from "@sd/shared";
import type { PublicNewsletterArchiveDTO } from "@sd/shared";
import { apiJson, type PagesEnv } from "./_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  const data = await apiJson<PublicNewsletterArchiveDTO>(env, "/newsletter-public/issues");

  const body = renderNewsletterRssXml({
    origin,
    issues: data?.issues ?? [],
    branding: data?.branding ?? {
      newsletterTitle: "Newsletter",
      accentColor: "#0068A8",
      logoUrl: null,
      footerHtml: "",
      calendarUrl: "",
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      // Same cache as the archive page it mirrors: readers poll feeds on
      // timers, so five minutes at the edge absorbs that for free.
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
};
