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

- `/`, `/n/:slug`, `/subscribe` and `/subscribe/confirm/:token` are handled by
  `functions/`, and Functions take precedence over static assets.
- Every other path falls through to `index.html`, because this project ships no
  `404.html` — that is Pages' single-page-app behaviour.

So the app's routes (`/sign-in`, `/check-email`, `/preferences`,
`/unsubscribe/:token`, `/admin`, `/admin/*`) load the bundle, and the public
pages stay server-rendered. Verify with `wrangler pages dev` after any change to
`functions/` or the route table in `src/app.tsx`.

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
