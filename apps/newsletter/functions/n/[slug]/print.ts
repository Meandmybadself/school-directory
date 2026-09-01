// GET /n/:slug/print — the same published issue, laid out for paper.
//
// This project's "save as PDF": there is no PDF renderer here and adding one
// would be a second place for a newsletter's look to drift from the email
// (invariant 9), so the page reuses the one renderer, leans on the @media print
// block in NEWSLETTER_WEB_CSS, and lets the browser's own print engine produce
// the file. Same data, same gate, same markup as /n/:slug — the only
// differences are that the print dialog opens on load and the page carries no
// link back to itself.

import { renderIssuePage, type PagesEnv } from "../../_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const slug = String(context.params.slug ?? "");

  return renderIssuePage(context.env, {
    apiPath: `/newsletter-public/issues/${encodeURIComponent(slug)}`,
    // Points at the readable page, not at this one: a print view is a rendering
    // of that page, and it is the one that should be shared or indexed.
    canonical: `${origin}/n/${encodeURIComponent(slug)}`,
    archiveHref: "/",
    printHref: "",
    print: true,
    cacheable: true,
    // No language bar on paper: it is navigation, and the print stylesheet
    // hides it anyway.
    issueUrl: "",
    notFoundHint: "That issue isn't available.",
  });
};
