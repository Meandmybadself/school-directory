# Routing: which paths are Functions and which are the bundle

This app is split the same way `apps/newsletter` is, and for the same reasons.
Read `apps/newsletter/ROUTING.md` too — the `_redirects` trap it documents
applies here identically.

## The split

**Pages Functions** (server-rendered, no bundle, works with JavaScript off):

- `/` — the storefront
- `/p/:slug` — one product
- `/o/:token` — one order's status
- `/robots.txt`, `/sitemap.xml`

**The SPA bundle** (everything else falls through to `index.html`):

- `/cart`, `/orders`, `/admin`, `/admin/orders`, `/sign-in`, `/check-email`,
  `/app`

The line is drawn at *who arrives here and how*. `/` and `/p/:slug` are what a
stranger opens from a text message or a class Facebook group: they need real
link previews, they need to be indexed, and they must not cost a first-time
visitor an app bundle to look at a t-shirt. `/o/:token` is reached from a
confirmation email by someone who may have no account at all — the bundle could
not authenticate them anyway (below), so there is nothing for it to add.

The cart is the opposite case. It is stateful, it is reached only after someone
has decided to buy, and it has to talk to the API across origins with a
credentialed `fetch`. That is bundle work.

## Do not add `public/_redirects`

Pages canonicalises `/index.html` to `/` with a 308, so an exact-match rewrite
like

```
/admin  /index.html  200
```

sends `/admin` to a 308 that lands on `/` — which is the storefront Function. An
admin following a link to `/admin` would end up shopping. (Splat rules such as
`/admin/*` happen to survive this, which makes the failure look intermittent and
route-specific.)

None of it is needed. Functions take precedence over static assets, and every
path they don't claim falls through to `index.html` because this project ships
no `404.html` — that is Pages' single-page-app behaviour.

Verify with `wrangler pages dev` after any change to `functions/` or the route
table in `src/app.tsx`. Note that `pnpm dev` (plain `vite`) serves the **bundle
only**: the storefront does not exist there, which is why `/` renders a short
note pointing at `/cart` and `/admin` instead of a second, drifting copy of the
shop.

## Why the order page is a Function and "my orders" is a bundle route

They look like the same page and are not. `/o/:token` is authorised by holding
the token; `/orders` is authorised by a session. The session cookie is host-only
to the API's hostname and is **never** present on a navigation to this origin,
so a Function here cannot tell a member from a stranger — only the bundle can,
by calling the API with `credentials: "include"`. This is the same reasoning
that makes the newsletter's admin print view an SPA route while its readers'
print views are Functions.

## `/o/:token` must never become cacheable

It passes through `htmlPrivate()`, which sends `no-store, private` plus
`x-robots-tag: noindex, nofollow`. The shared cache is keyed on the URL, so a
cacheable response would let the edge hand the next reader of that URL somebody
else's order — and would keep serving it after anything changed. Same rule, same
reason, as the newsletter's `/preview/:token`.

## Why "Add to cart" is a `<form method="get">`

The product page ships no JavaScript, so it cannot write to `localStorage`
itself. The form navigates to `/cart?add=<variantId>&p=<slug>`; the cart screen
resolves those two ids against the API, adds the line, and strips the params so
a refresh doesn't add it twice. It carries ids only — never a price, never a
Printful id.

The alternative would be loading the bundle on the product page, which would
undo the reason that page is server-rendered at all.

## `?lang=` stays in the URL here

Unlike the three SPAs, which apply `?lang=` and strip it, these pages keep it —
exactly as `apps/home` does. A stable per-language URL is what the `hreflang`
alternates in `functions/_lib/page.ts` point at, and what someone sharing a link
in their own language needs. Because the response varies on the `sd_lang`
cookie, `html()` sends `Vary: Accept-Language, Cookie`; without that a shared
cache would hand the next reader the previous one's language.
