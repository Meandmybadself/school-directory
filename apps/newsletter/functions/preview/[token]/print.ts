// GET /preview/:token/print — the review page, laid out for paper.
//
// The print twin of ../[token].ts, and it inherits the same rule that matters:
// cacheable is false, because the token is in the URL. See that file.

import { renderIssuePage, type PagesEnv } from "../../_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const token = String(context.params.token ?? "");

  return renderIssuePage(context.env, {
    apiPath: `/newsletter-public/preview/${encodeURIComponent(token)}`,
    canonical: `${origin}/preview/${encodeURIComponent(token)}`,
    archiveHref: "",
    printHref: "",
    print: true,
    cacheable: false,
    // A token url, and a print view. Both answers are "".
    issueUrl: "",
    notFoundHint: "This preview link is no longer active.",
  });
};
