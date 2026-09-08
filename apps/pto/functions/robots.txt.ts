// GET /robots.txt
//
// The third surface in this project that asks to be indexed, after apps/home
// and the store's storefront, so it needs one.
//
// The disallow list is belt to the braces the bundle already wears: index.html
// sends `noindex,nofollow`, and nothing behind `/app` renders without a session
// anyway. A crawler that reads only one of the two still gets the right answer.
//
// Everything listed is a members-only board route. `/b/` in particular is the
// board itself — a slug there is not a capability (the API gates every read on
// PTO-board membership), but a board's TITLE has no business in a search index.

export const onRequestGet: PagesFunction = ({ request }) => {
  const origin = new URL(request.url).origin;
  const body = `User-agent: *
Allow: /
Disallow: /app
Disallow: /boards
Disallow: /b/
Disallow: /settings
Disallow: /sign-in
Disallow: /check-email

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
};
