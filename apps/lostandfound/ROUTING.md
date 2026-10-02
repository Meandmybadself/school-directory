# Routing — apps/lostandfound

`lostandfound.eisenhower.school` is a **pure static Pages deploy**: everything,
the public browse page included, is in the Vite bundle. There are no Pages
Functions, no `wrangler.toml` and no `public/_redirects` (see CLAUDE.md on why a
SPA-fallback `_redirects` breaks Pages' own `/index.html` → `/` handling).

Unknown paths fall through to `index.html` because the project has no
`404.html`, and the router sends anything it doesn't know back to `/`.

| Path | Who | What |
| --- | --- | --- |
| `/` | anyone | Browse + search found items (`/lostfound-public/items`) |
| `/item/:id` | anyone | One item, and the "that's mine" claim form |
| `/sign-in`, `/check-email` | staff | Magic-link sign-in, returning to this origin |
| `/staff` | staff roster | Claims, then items by tab |
| `/staff/upload` | staff roster | Phone upload (resized + EXIF-stripped in the browser) |
| `/staff/item/:id` | staff roster | Edit, hide, return, re-run AI, delete |
| `/staff/settings` | system admin | Pick the group whose roster is staff |

Why no server rendering, when the store and the PTO page have it: those want
to be **indexed**. This site is public but deliberately `noindex` (invariant
33) — a found jacket is its owner's business, not a search engine's — so a
Function would add a second rendering path and buy nothing. `index.html`
carries `noindex,nofollow` and `public/robots.txt` disallows everything.

The staff gate is checked twice: by `RequireStaff` in `src/app.tsx` to decide
what to render, and authoritatively by the API on every `/lostfound/*` route.

## Provisioning (once, by hand)

CI deploys to the project; it does not create it. As for every front end here:

```sh
export CLOUDFLARE_ACCOUNT_ID=c3b373ae8a90a6494e520f962bdf462b
pnpm exec wrangler pages project create school-lostandfound --production-branch main
pnpm build && pnpm exec wrangler pages deploy dist --project-name school-lostandfound --branch main
# attach the custom domain to the Pages project, then add the DNS record the
# Pages domain API does NOT create for you:
#   CNAME lostandfound → school-lostandfound.pages.dev (proxied)
```

Local dev: `pnpm dev:lostandfound` → http://localhost:5179, against the API on
8787 (which must list `http://localhost:5179` in `ALLOWED_ORIGINS`).
