# Routing: why there is no `public/_redirects`

The obvious way to make an SPA's client-side routes work on Cloudflare Pages is
a `_redirects` file rewriting them to `/index.html`. **Don't add one to this
project** — it actively breaks the routing rather than fixing it.

Pages canonicalizes `/index.html` to `/` with a 308. An exact-match rewrite like

```
/admin  /index.html  200
```

therefore sends `/admin` to a 308 that lands on `/`, which is the public archive
Function — so an admin following a link to `/admin` ends up reading the
newsletter instead of editing it. (Splat rules such as `/admin/*` happen to
survive this, which makes the failure look intermittent and route-specific.)

None of it is needed. Pages already does the right thing here:

- `/`, `/n/:slug`, `/n/:slug/print`, `/preview/:token`, `/preview/:token/print`,
  `/subscribe` and `/subscribe/confirm/:token` are handled by `functions/`, and
  Functions take precedence over static assets.
- Every other path falls through to `index.html`, because this project ships no
  `404.html` — that is Pages' single-page-app behaviour.

So the app's routes (`/sign-in`, `/check-email`, `/preferences`,
`/unsubscribe/:token`, `/admin`, `/admin/*`) load the bundle, and the public
pages stay server-rendered. Verify with `wrangler pages dev` after any change to
`functions/` or the route table in `src/app.tsx`.

## Why the admin's "View as PDF" is an SPA route and the readers' are Functions

`/admin/issues/:id/print` is a bundle route; `/n/:slug/print` and
`/preview/:token/print` are Functions. They render the identical markup, through
the identical `@sd/shared` function, so the split can look arbitrary. It isn't:
the session cookie is host-only to the API's hostname and is never present on a
navigation to THIS origin, so a Function here cannot tell an admin from a
stranger (see `functions/_lib/page.ts`). An admin printing an unsent issue has to
be authenticated, which only the bundle can do — it calls the API with
`credentials: "include"`.

Reader-facing print views can't be SPA routes for the mirror-image reason: they
must work with no bundle, no JavaScript and no account.

## `/preview/:token` must never become cacheable

Both preview Functions pass `cacheable: false` to `renderIssuePage`, which sends
them through `htmlPrivate()`. The token is in the URL and the shared cache is
keyed on it, so caching one would let a revoked link keep being answered from the
edge after `DELETE /newsletter/issues/:id/preview-link` — silently undoing the one
guarantee the feature makes. It also keeps the token out of referrers and out of
search indexes.

## Why subscribe is a Function and unsubscribe is an SPA route

They look symmetrical and aren't. `/unsubscribe/:token` is reached only from a
link inside an issue, by someone who is already a subscriber — the bundle is a
cost they've effectively already paid. `/subscribe` is linked from the public
archive index and is the first thing a stranger touches, so it follows the same
rule as the archive itself: server-rendered, no bundle, works with JavaScript
off. Both halves of the sign-up (the form and `/subscribe/confirm/:token`) are
plain `<form>` POSTs to their own Function for that reason.

Do not add an SPA route for either — a client route would shadow nothing (the
Functions win) but would leave dead code that looks live.
