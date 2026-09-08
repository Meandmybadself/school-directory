# Routing: which paths are Functions and which are the bundle

This app is split the same way `apps/newsletter` and `apps/store` are, and for
the same reasons. Read `apps/newsletter/ROUTING.md` too — the `_redirects` trap
it documents applies here identically, and is restated below because it has now
bitten twice.

## The split

**Pages Functions** (server-rendered, no bundle, works with JavaScript off):

- `/` — the public page: what the PTO does, who runs it, the year, how to help
  or give
- `/robots.txt`, `/sitemap.xml`

**The SPA bundle** (everything else falls through to `index.html`):

- `/app`, `/boards`, `/b/:slug`, `/settings`, `/sign-in`, `/check-email`

The line is drawn at *who arrives here and how*, and here it happens to fall
exactly on the privacy boundary too. `/` is what a family opens when somebody
says "what even is the PTO?" — it needs a real link preview, it needs to be
indexed, and it must not cost a first-time visitor an app bundle to read four
paragraphs of prose. Everything else is the PTO board's planning tool: gated on a
session **and** on membership of the PTO board group, stateful, and useless to
anyone else.

That means this app has a property `apps/store` does not: **no Function here
reads anything member-scoped.** The public page's only subrequest is to the
anonymous `/calendar-public/events`, the same read `apps/home` makes. Every
`pto_*` table is reached exclusively through the bundle's credentialed `fetch` to
`/pto/*`. Keep it that way — if a Function ever needs board data, the answer is
that it shouldn't have it.

## Do not add `public/_redirects`

Pages canonicalises `/index.html` to `/` with a 308, so an exact-match rewrite
like

```
/boards  /index.html  200
```

sends `/boards` to a 308 that lands on `/` — which is the public page Function.
A board member following a link to `/boards` would end up reading the brochure.
(Splat rules such as `/b/*` happen to survive this, which makes the failure look
intermittent and route-specific.)

None of it is needed. Functions take precedence over static assets, and every
path they don't claim falls through to `index.html` because this project ships no
`404.html` — that is Pages' single-page-app behaviour.

Verify with `wrangler pages dev` after any change to `functions/` or the route
table in `src/app.tsx`. Note that `pnpm dev` (plain `vite`) serves the **bundle
only**: the public page does not exist there, which is why `/` renders a short
note pointing at `/app` instead of a second, drifting copy of it.

## Why the boards are a bundle route and not a Function

The session cookie is host-only to the API's hostname and is **never** present on
a navigation to this origin, so a Function here cannot tell a board member from a
stranger — only the bundle can, by calling the API with `credentials: "include"`.
Same reasoning that makes the newsletter's admin print view an SPA route while
its readers' print views are Functions, and the store's `/orders` a bundle route
while `/o/:token` is not.

There is no token-addressed page in this app at all, deliberately. A board is
not the kind of thing that should be shareable by URL alone.

## `?lang=` stays in the URL here

Unlike the SPAs, which apply `?lang=` and strip it, this page keeps it — exactly
as `apps/home` and the storefront do. A stable per-language URL is what the
`hreflang` alternates in `functions/_lib/page.ts` point at, and what someone
sharing this page in their own language needs. Because the response varies on the
`sd_lang` cookie, `html()` sends `Vary: Accept-Language, Cookie`; without that a
shared cache would hand the next reader the previous one's language.

## The board app is English

The public page is translated into all four languages, like everything else a
family reads. The boards are not, and that is the same call the calendar's and
the newsletter's admin screens make: they are authoring tools for a handful of
volunteers, and the copy on them changes with the feature rather than with the
audience. The one exception is the card a member sees when the boards are *not*
for them (`ptoNoAccess*`), which is translated — because an ordinary member is
exactly who reads it.

## Standing this app up the first time

CI deploys to the Pages project; it does not create it. Both steps below are
one-time and are run by hand, exactly as `apps/store/SETUP.md` §4 records for the
store — including step 4, which is the one everybody misses.

```bash
cd apps/pto
export CLOUDFLARE_ACCOUNT_ID=c3b373ae8a90a6494e520f962bdf462b

# 1. The project. Must exist BEFORE CI runs — `wrangler pages deploy` will not
#    create it in a non-interactive shell, so the workflow's pto step fails
#    without this. `--production-branch main` must match the workflow's
#    `--branch main`, or every deploy publishes as a preview instead.
pnpm exec wrangler pages project create school-pto --production-branch main

# 2. One deployment, because a custom domain will not serve until the project
#    has something to serve. CI handles every deploy after this.
pnpm build && pnpm exec wrangler pages deploy

# 3. Attach the domain to the project.
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/school-pto/domains" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"pto.eisenhower.school"}'

# 4. CREATE THE DNS RECORD. Step 3 registers the domain against the Pages
#    project and creates NO DNS; without this the domain sits at
#    `status: pending` forever and the hostname does not resolve at all.
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/689f6323a55417c703d2b05b2c2aad31/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"pto","content":"school-pto.pages.dev","proxied":true}'
```

Then, once somebody has signed in: an admin creates a `generic` group in the
directory, adds the board members to it, and names it in this app's `/settings`.
Until that happens only system admins can open the boards — the bootstrap state,
not a broken one.
