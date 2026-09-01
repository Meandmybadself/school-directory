// GET /n/:slug — one published issue.
//
// This is the URL printed in every email's "view in browser" link, so it has to
// work with no session, no JavaScript and no prior visit. All the rendering
// lives in renderIssuePage (../_lib/page.ts), which runs the stored document
// through @sd/shared's renderer — the very same one that produced the email —
// over the SAME frozen events snapshot, which is what guarantees the archive
// can't drift from what was mailed.
//
// Only issues whose status is 'sent' are served; a guessed draft slug 404s,
// because the API gates this path on `status = 'sent'` in SQL. An unsent issue
// is readable only through a review link an admin minted on purpose, which is a
// different route on a different column (see /preview/[token].ts).

import { localeFromSearch, translateProxyUrl } from "@sd/shared";
import { renderIssuePage, type PagesEnv } from "../_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const origin = url.origin;
  const slug = String(context.params.slug ?? "");
  const path = `/n/${encodeURIComponent(slug)}`;
  const canonical = `${origin}${path}`;

  // `?lang=xx` — the form every issue ever mailed carries, because a sent issue
  // is immutable (invariant 10) and its links have to stay ours to re-point.
  // This is where they resolve: a redirect out to whatever translation service
  // we are using today, chosen here rather than baked into somebody's inbox.
  //
  // Note what the target does NOT carry: a `lang` of its own. Google's fetcher
  // forwards a proxied page's query string to the origin verbatim, so a target
  // that kept `?lang=` would make the proxy's own fetch land back on this
  // redirect. Dropping it means the proxy always fetches the plain page.
  const wanted = localeFromSearch(url.search);
  if (wanted) {
    const proxied = translateProxyUrl(canonical, wanted);
    // `en` and an unusable origin both give null and fall through to the page
    // itself, which is the right answer for both: the issue is already in
    // English, and local dev has nothing a proxy could fetch.
    if (proxied) {
      return new Response(null, {
        status: 302,
        headers: {
          location: proxied,
          // Same short window the page itself uses. The mapping is
          // deterministic, but keeping it brief is what lets us change services
          // without a stale edge copy still pointing at the old one.
          "cache-control": "public, max-age=60, s-maxage=300",
        },
      });
    }
  }

  return renderIssuePage(context.env, {
    apiPath: `/newsletter-public/issues/${encodeURIComponent(slug)}`,
    canonical,
    archiveHref: "/",
    printHref: `${path}/print`,
    print: false,
    cacheable: true,
    // The one surface that gets a language bar: a sent issue, publicly
    // fetchable by anyone including Google's proxy.
    issueUrl: canonical,
    notFoundHint: "That issue isn't available.",
  });
};
