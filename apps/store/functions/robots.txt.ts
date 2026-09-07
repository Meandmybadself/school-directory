// GET /robots.txt
//
// This is the second surface in the project that asks to be indexed (apps/home
// is the first), so it needs one. The disallow list is belt to the braces the
// pages already wear: the bundle's index.html sends `noindex`, and the order
// page is served with `x-robots-tag: noindex, nofollow` by htmlPrivate(). A
// crawler that reads only one of the two still gets the right answer.
//
// /o/ is listed even though its URLs are unguessable — a token that reached a
// crawler through a referrer or a pasted link should still be refused.

export const onRequestGet: PagesFunction = ({ request }) => {
  const origin = new URL(request.url).origin;
  const body = `User-agent: *
Allow: /
Disallow: /cart
Disallow: /o/
Disallow: /admin
Disallow: /orders
Disallow: /sign-in
Disallow: /check-email

Sitemap: ${origin}/sitemap.xml
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
};
