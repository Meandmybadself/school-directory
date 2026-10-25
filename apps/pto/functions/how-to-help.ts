// GET /how-to-help — 301 to the landing page, which absorbed this page's
// content (the live volunteer list and the wishlists) when the two merged.
//
// The URL was indexed and circulated, so it keeps answering rather than
// falling through to the members-only bundle. `?lang=` is carried over the
// way every link on this origin carries it; a fragment needs no help — the
// Location below names none, so a browser re-applies the original one, and
// the landing page keeps `#volunteer` and `#wishlists` anchors for exactly
// the links that used to point here.

import { LANG_PARAM } from "./_lib/locale.js";

export const onRequestGet: PagesFunction = ({ request }) => {
  const url = new URL(request.url);
  const lang = url.searchParams.get(LANG_PARAM);
  const target = new URL(lang ? `/?${LANG_PARAM}=${encodeURIComponent(lang)}` : "/", url.origin);
  return Response.redirect(target.toString(), 301);
};
