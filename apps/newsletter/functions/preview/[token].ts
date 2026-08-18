// GET /preview/:token — one issue by the review link an admin minted for it.
//
// The point of the feature: an issue can be read before it is sent, by somebody
// who has no directory account. Holding the token is the whole of the
// authorization (migration 0015), so three things about this page are
// load-bearing:
//
//   It is served by htmlPrivate(), never html(). The shared cache is keyed on
//   the URL, so caching this would let a revoked link keep being answered from
//   the edge — silently undoing the one guarantee the feature makes — and would
//   put the token in a cache somebody else can reach. htmlPrivate also keeps it
//   out of referrers and out of search indexes.
//
//   It offers no way back to the archive. An unsent issue has no /n/ page yet,
//   and linking one would send a reviewer to a 404.
//
//   It says it is a draft, above the content — see the banner in
//   renderNewsletterIssuePageHtml. A reviewer sent a bare link has no other way
//   to tell a draft from the real thing.
//
// A token keeps working after the issue is sent (it is revocable, with no
// expiry), at which point this page simply shows the sent issue instead — what
// somebody re-opening a link they were sent would expect.

import { renderIssuePage, type PagesEnv } from "../_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const token = String(context.params.token ?? "");
  const path = `/preview/${encodeURIComponent(token)}`;

  return renderIssuePage(context.env, {
    apiPath: `/newsletter-public/preview/${encodeURIComponent(token)}`,
    canonical: `${origin}${path}`,
    archiveHref: "",
    printHref: `${path}/print`,
    print: false,
    cacheable: false,
    notFoundHint: "This preview link is no longer active.",
  });
};
