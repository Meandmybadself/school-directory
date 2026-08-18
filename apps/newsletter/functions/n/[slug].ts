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

import { renderIssuePage, type PagesEnv } from "../_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const slug = String(context.params.slug ?? "");
  const path = `/n/${encodeURIComponent(slug)}`;

  return renderIssuePage(context.env, {
    apiPath: `/newsletter-public/issues/${encodeURIComponent(slug)}`,
    canonical: `${origin}${path}`,
    archiveHref: "/",
    printHref: `${path}/print`,
    print: false,
    cacheable: true,
    notFoundHint: "That issue isn't available.",
  });
};
