# CLAUDE.md — working notes for agents in this repo

Read this before making changes. It captures the non-obvious rules; the product
spec is in `docs/` and the engineering plan in `PLAN.md`.

## What this is

Single-tenant, members-only **school directory**. Identity foundation for later
services. Cloudflare-native: React/Vite (Pages) + Hono (Workers) + D1 + R2,
Resend email, Nominatim geocoding.

## Repository layout

```
apps/web            Directory SPA (Vite) → directory.eisenhower.school. Design system in src/components, screens in src/screens.
apps/calendar       Calendar SPA (Vite) → calendar.eisenhower.school. Shares the API, D1 and session; design system is COPIED, not imported.
apps/newsletter     Newsletter SPA (Vite) → newsletter.eisenhower.school. Admin authoring (TipTap) + a member preferences screen, PLUS Pages Functions serving the public archive. Design system COPIED.
apps/api            Hono Worker → api-directory.eisenhower.school. Serves ALL THREE SPAs. Routes in src/routes, logic in src/lib, middleware in src/middleware.
apps/redirect       One-file Worker owning the retired directory.meandmybadself.com; 301s to the live host.
apps/api/migrations Ordered D1 SQL migrations (NNNN_name.sql). Never edit an applied migration — add a new one.
packages/shared     Domain types (types.ts) + i18n dictionaries (i18n.ts). Imported as `@sd/shared`.
docs/               Product spec (PLAN/SRD/SDD). Source of truth for requirements.
design_handoff_*/   Hi-fi design reference. NOT a build target — port, don't ship.
```

## Three front ends, one API

All three SPAs are separate Cloudflare Pages projects talking to the single
`apps/api` Worker, and they share one session:

- The `sd_session` cookie has **no `Domain`** — it's host-only to the API's own
  hostname. All three SPAs are on `eisenhower.school` subdomains, so a credentialed
  `fetch` to the API is same-site and the cookie rides along. Don't "fix" this by
  adding a `Domain` attribute.
- **Every new front-end origin must be added to `ALLOWED_ORIGINS`** in
  `apps/api/wrangler.toml` (both `[vars]` and `[env.production.vars]`). That one
  list is also the allowlist of valid magic-link `returnTo` targets — same trust
  boundary, deliberately one variable.
- `apps/calendar` and `apps/newsletter` **copy** `tokens.css`, `Icon.tsx`,
  `atoms.tsx` and the generic half of `parts.tsx` from `apps/web` rather than
  importing them. They're expected to drift. If you change a shared-looking
  component, decide which copies need it. The nav item list is duplicated in each
  app's `AppShell`/`DesktopShell`.
- `apps/newsletter` is the only app with a `wrangler.toml` among the Pages
  projects, because it's the only one with `functions/`. Those Pages Functions
  server-render the public archive (`/` and `/n/:slug`) so a link pasted into a
  text message gets a real preview and a reader never downloads the authoring
  bundle. **Do not add a `_redirects` file there** — Pages 308s `/index.html` to
  `/`, so an SPA-fallback rewrite sends `/admin` to the public archive instead of
  the app. Functions already take precedence over assets, and every other path
  falls through to `index.html` on its own. See `apps/newsletter/ROUTING.md`.
- The calendar owns all calendar admin. `apps/web`'s Admin has no calendar tab —
  just a link out. `apps/web` keeps only `api.calendarEvents` (for Home's
  upcoming-events block); `/calendar` there is a redirect to the calendar site.
- **The calendar's home screen is public.** `/` in `apps/calendar` is ungated on
  purpose: anyone can read the agenda without signing in. It reads
  `/calendar-public/*` (no `requireAuth`, like `ics.ts` and `newsletterPublic.ts`),
  NOT the members-only `/calendar/*` — which still exist, still require auth, and
  are what `apps/web` uses. Admin routes stay gated on both sides. See invariant
  12 before adding a field to any calendar DTO.

## Non-negotiable invariants

1. **Privacy is resolved server-side only.** Never send a client data it can't
   see. All filtering lives in `apps/api/src/lib/privacy.ts` + `serialize.ts`.
2. **Geo-coordinates never leave the server.** `geo_lat`/`geo_lng` are never put
   in any DTO. Neighbor responses carry a rounded distance string only.
3. **New fields default to `private`** (NFR-1). Neighbor discovery is opt-in and
   independent of address visibility.
4. **No account enumeration.** `/auth/start` and registration-closed responses
   are identical whether or not the email exists.
5. **All mutating routes push audit drafts** to `c.var.audit`; the audit
   middleware persists them (hash-chained). Don't write `audit_log` directly.
6. **UI copy comes from `@sd/shared` i18n dictionaries** — never hardcode user-
   facing English in a component. Member-entered content is never translated.
7. **IDs are ULIDs** (`lib/ids.ts`); timestamps are ISO-8601 UTC strings.
8. **`calendar_event` is a derived cache, and its row ids are NOT stable.** Both
   imported feeds and managed events delete-then-insert into it, minting fresh
   ULIDs. Anything that needs a durable handle on an event (the coming volunteer
   signups) must use a managed event's `(managed_event_id, starts_at)` pair — the
   ICS `UID` + `RECURRENCE-ID` convention, surfaced as `seriesId`/`recurrenceId`
   on `CalendarEventDTO`. The first consumer is already here: `eventKey`
   (`packages/shared/src/newsletterEvents.ts`) is how a newsletter remembers that
   an author removed one event from an events block. An imported event has no
   durable id at all, so it falls back to the content identity `dedupeEvents`
   already uses (kind + title + start-to-the-minute) — weaker, since retitling
   upstream drops the exclusion, but the strongest thing an ICS feed offers.
   Never key such a thing on `CalendarEventDTO.id`.
9. **One newsletter renderer.** A newsletter issue is stored as TipTap JSON and
   turned into HTML solely by `packages/shared/src/newsletterRender.ts` — used by
   the email, the composer's live preview, and the public archive page. It is
   also the sanitizer: it switches over a fixed node/mark allowlist and escapes
   all text, so it cannot emit a tag it doesn't know. Enabling a TipTap extension
   without adding its renderer case silently drops content. `sanitizeNewsletterDoc`
   applies the same allowlist on write.
   The **settings footer is the one raw-HTML seam**: an admin may hand-write
   `footerHtml`, which `sanitizeFooterHtml` (same file) reduces to a tag/attribute
   allowlist — dropping `<script>`-class elements with their contents, refusing
   `url()`/`expression()` CSS, and balancing tags so a footer can't swallow the
   archive page. It runs on WRITE (`coerceNewsletterSettings`), so what's stored
   is already safe. The footer is **HTML only** — there is no plain-text twin;
   `footerHtmlOf` hands the stored markup to the email and the archive, and
   `footerTextOf` flattens that same markup for the email's text part. Don't add
   a second place that interpolates admin HTML; route it through that function.
   `coerceNewsletterSettings` still promotes a legacy `footerText` into
   `footerHtml` on read, for settings blobs written before the fields merged;
   that fallback can go once every instance has saved settings again.
10. **A sent newsletter is immutable, and its web page is public.** Events blocks
   resolve live while a draft is edited and are FROZEN into `events_snapshot_json`
   at send, so the archive keeps matching what was mailed. Issue URLs are
   human-readable and therefore enumerable by design — nothing member-private may
   ever go in one.
11. **One recurrence engine.** Managed events are expanded by rendering them with
   `lib/icsWriter.ts` and parsing that text back through `parseIcs`
   (`lib/managedCalendar.ts`). Never hand-roll a second RRULE walker — the
   round-trip is what guarantees the published feed and the in-app agenda agree.
12. **The calendar's public seam is `publicEventOf` / `listPublicCalendarFeeds`**
   (`apps/api/src/lib/calendar.ts`). The anonymous agenda is served from
   `PublicCalendarEventDTO` / `PublicCalendarFeedDTO`, which are hand-written —
   not `Omit<>` of the member DTOs — so **a field added to `CalendarEventDTO`
   does NOT reach the public response until someone edits that projection on
   purpose.** Keep it that way: build the public shape field by field, never by
   spreading. Two withholdings are deliberate, not oversights: `seriesId`/
   `recurrenceId` are omitted entirely (the durable handle volunteer signups
   will key on — see invariant 8, so withholding it means member signup data can
   never be addressed from a public response), and an imported feed's upstream
   `url` is **replaced, never passed through** — an admin may have pasted a
   secret Google/Outlook subscribe link, and the raw feed carries
   ORGANIZER/ATTENDEE addresses we never store. Every public feed URL is on our
   own origin: `/ics/:id.ics` for a managed calendar, `/ics/source/:id.ics` for
   an imported one, which `renderImportedSourceIcs` MIRRORS out of stored
   `calendar_event` rows rather than proxying upstream. `test/
   calendarPublic.test.ts` asserts the exact public key set and that no upstream
   URL survives, and fails the build if either leaks.

## Conventions

- TypeScript strict everywhere. `verbatimModuleSyntax` is on — use
  `import type { … }` for type-only imports and `.js` extensions on relative
  imports (NodeNext/bundler ESM).
- D1 access is raw prepared statements (ORM-agnostic per the SDD). Use `.bind()`,
  never string-interpolate values into SQL.
- Design tokens are CSS variables under the `.sd` scope (see `apps/web`), matching
  the handoff exactly: `--blue #0068A8`, `--orange #FAAB1C`, etc.
- Visibility chip states: `members` (blue) / `private` (slate) / `shared` (orange).
  There is **no public state** anywhere in the UI.
- **Mobile shell layout is load-bearing.** `.sd-app` is exactly `100dvh`, so an
  `AppShell` screen must put its scrolling content inside a `.sd-scroll` child —
  that element carries the `min-height: 0` that lets it shrink and actually
  scroll. Content placed directly in `AppShell` will be clipped instead, and the
  bottom nav stays pinned only because the column can't outgrow the viewport.

## Local dev

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local && pnpm db:seed:local
pnpm dev          # web :5173, calendar :5174, newsletter :5175, api :8787
```

Magic links print to the **API console** when `RESEND_API_KEY` is empty — which
also means newsletter sends print there instead of mailing anyone. Demo login:
`dana@eisenhower.edu`.

`vite dev` serves the newsletter SPA only; the public archive at `/` and
`/n/:slug` is Pages Functions, so it exists in `wrangler pages dev` and in
production, not in `pnpm dev`.

## When adding a migration

Create `apps/api/migrations/NNNN_description.sql` (next number). Update
`packages/shared/src/types.ts` if the wire shape changes. Re-run
`pnpm db:migrate:local`.

## Commit / PR

- Conventional-ish messages; keep commits scoped to one concern.
- CI must pass `pnpm typecheck` and `pnpm test`. Deploy happens on merge to `main`.
