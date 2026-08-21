# CLAUDE.md — working notes for agents in this repo

Read this before making changes. It captures the non-obvious rules; the product
spec is in `docs/` and the engineering plan in `PLAN.md`.

## What this is

Single-tenant, members-only **school directory**. Identity foundation for later
services. Cloudflare-native: React/Vite (Pages) + Hono (Workers) + D1 + R2,
Resend email, Nominatim geocoding.

## Repository layout

```
apps/home           One-page Worker owning the apex, eisenhower.school. Server-rendered, no bundle; the only surface here that wants to be indexed.
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

## The front door

`apps/home` serves `eisenhower.school` (and 301s `www`). It is not a fourth SPA:
one HTML document per request, rendered from the shared dictionaries, no client
bundle and no API call. Three things about it are load-bearing:

- **It is the only page in this project that asks to be indexed.** The three
  SPAs send `noindex` because they are members-only. This one ships a
  `robots.txt`, a sitemap and `hreflang` alternates, so nothing member-private
  may ever appear on it.
- **The hero greeting stack is the language picker**, and it is the one place
  that reads ACROSS `dictionaries` rather than within one locale — it shows all
  four `landingWelcome` strings at once, in `LOCALES` order, with the current
  one marked. Adding a locale to `LOCALES` therefore adds a line to the hero for
  free; adding one WITHOUT a `landingWelcome` breaks the type.
- **`?lang=` stays in the URL here**, unlike in the SPAs, which apply it and
  strip it. There is no client to remember a choice, and a stable per-language
  URL is what `hreflang` and a shared link both need. Outbound links to the apps
  carry `?lang=` so the reader's language travels with them.

- **It makes exactly one subrequest**, and it is the upcoming-events block:
  `events.ts` reads the ANONYMOUS `/calendar-public/events` (never the
  members-only twin — this is the one indexed surface in the project, so
  invariant 12's projection is what keeps it safe). It is edge-cached, times out
  fast, and **every failure mode resolves to an empty list, which hides the
  block** — an API outage must never take the front door down. Dates are read
  live rather than transcribed for the obvious reason: a date copied onto this
  page is wrong the moment the school moves it, and this page has no editor.
  Rows link to `/e/:date/:slug` on the calendar, minted in `SCHOOL_TIMEZONE`
  since a Worker has no reader timezone.
- **It repeats the school district's contacts and links**, transcribed from the
  back-to-school mailing into `apps/home/src/district.ts` — phone numbers, URLs,
  a street address and the bell times, since the words that label them are
  dictionary keys like everything else. School NAMES live there too: a proper
  noun, configuration in the same sense `SCHOOL_CITY` is. Nothing in that file
  expires, which is why it may be transcribed at all. The block names
  `DISTRICT_NAME` and links to `DISTRICT_URL`, because none of it is the PTO's
  to change.

This hostname used to be a Cloudflare redirect rule pointing at
`eisenhower.hopkinsschools.org`; the rule was deleted when the Worker took over,
and redirect rules run BEFORE Workers, so if the apex ever starts 301ing again,
look for a resurrected rule in the `eisenhower.school` zone before debugging the
Worker. People still arrive here looking for the district's site, which is why
every rendering carries a link out to it in the header.

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
- **So is a volunteer sheet at `/v/:slug`.** Same pattern, one wrinkle: that
  screen picks its endpoint by whether there's a session — the anonymous one when
  signed out (counts, no names), the member one when signed in. Signing up is a
  write and always needs an account. See invariant 13.
- **And so is one event's own page at `/e/:date/:slug`.** Tapping a row on the
  agenda goes there rather than opening a modal, and it is where the
  description, the volunteer sheet (inline, via
  `components/VolunteerPositions.tsx`) and the admin edit form all live. There is
  deliberately **no per-event `.ics` download** — a copy of one occurrence goes
  stale the moment the school moves the date, and the calendar-level subscribe on
  the agenda's filter bar is the affordance that keeps up. The
  path is a CONTENT identity — day + title slug, minted by `eventPath` in
  `@sd/shared` and matched by `findEventByPath` — because an event has no
  durable public id to put in a URL; see invariant 8 and
  `packages/shared/src/eventPath.ts` for the trade that makes. The app mints the
  day in the READER'S timezone, so the lookup searches ±1 day and takes the
  occurrence nearest the requested date; that is what makes a weekly series
  resolve to the right week. The screen reads the public route, and re-reads the
  members-only twin only for a system admin — the one thing that adds is
  `seriesId`, which the edit form needs. The agenda itself no longer does that
  re-read at all, and is now written purely against `PublicCalendarEventDTO`.
  **The newsletter's events blocks link every event title here**, in the email,
  the composer preview and the public archive alike (one renderer — invariant 9),
  minting the day in the ISSUE'S `SCHOOL_TIMEZONE` rather than a reader's. Note
  what that means for the archive, which is permanent: `calendar_event` keeps
  only ~2 days of past events, so an archived issue's event links stop resolving
  shortly after the event happens and land on the page's "event not found" card.
  That is inherent to addressing an event at all, not a bug in the link.

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
   ULIDs. Anything that needs a durable handle on an event must use a managed
   event's `(managed_event_id, starts_at)` pair — the
   ICS `UID` + `RECURRENCE-ID` convention, surfaced as `seriesId`/`recurrenceId`
   on `CalendarEventDTO`. `volunteer_sheet` is the load-bearing consumer: it
   stores exactly that pair (`managed_event_id` + `occurrence_start`) and
   reads its event from `managed_event`, never from `calendar_event` — see
   invariant 13. `eventKey`
   (`packages/shared/src/newsletterEvents.ts`) is how a newsletter remembers that
   an author removed one event from an events block. An imported event has no
   durable id at all, so it falls back to the content identity `dedupeEvents`
   already uses (kind + title + start-to-the-minute) — weaker, since retitling
   upstream drops the exclusion, but the strongest thing an ICS feed offers.
   Never key such a thing on `CalendarEventDTO.id`.
   The calendar's event page URL (`/e/:date/:slug`) takes that same content
   identity one step further: it uses it for managed and imported events alike,
   because a URL is minted by a browser that was never given the durable pair.
   Retitling or moving an event therefore drops links to the old one — the same
   weakness `eventKey` accepts, taken deliberately, since the alternative is an
   event page an imported event could never have.
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
   key on — see invariant 8, so withholding it means member signup data can
   never be addressed from a public response), and an imported feed's upstream
   `url` is **replaced, never passed through** — an admin may have pasted a
   secret Google/Outlook subscribe link, and the raw feed carries
   ORGANIZER/ATTENDEE addresses we never store. Every public feed URL is on our
   own origin: `/ics/:id.ics` for a managed calendar, `/ics/source/:id.ics` for
   an imported one, which `renderImportedSourceIcs` MIRRORS out of stored
   `calendar_event` rows rather than proxying upstream. `test/
   calendarPublic.test.ts` asserts the exact public key set and that no upstream
   URL survives, and fails the build if either leaks.
   **One field has been added to that public shape since**: `volunteerSlug`. It
   is an opaque handle on a volunteer sheet's own public page (invariant 13), not
   the durable pair — a sheet has a slug of its own precisely so the public link
   needn't carry `(seriesId, recurrenceId)`. That is the bar for adding another
   one — and the event page at `/e/:date/:slug` did NOT clear it, because it did
   not have to: it addresses an event by content identity and renders the
   `volunteerSlug` already here. Nothing new joined this projection for it, and
   the count is still one.
13. **Volunteer counts are public; volunteer NAMES are members-only.** A sheet
   (`volunteer_sheet` → `volunteer_position` → `volunteer_signup`, migration
   0012) hangs off ONE occurrence of a managed event and is read by three
   audiences through two routes: `/volunteers-public/sheets/:slug` (no auth, like
   `calendarPublic.ts`) returns positions and a `filled` count, and
   `/volunteers/sheets/:slug` (auth) returns the same plus who took each spot.
   The seam is **`publicSheetOf`** in `apps/api/src/lib/volunteers.ts`, the
   companion to `publicEventOf` and built the same way — field by field, never by
   spreading. A sheet URL is human-readable and enumerable by design (it has to
   open from a text message), so a name reaching that response is a member's name
   on the open internet; `test/volunteersPublic.test.ts` asserts the exact key
   sets at all three levels AND that no name, note or person id survives.
   Three further rules follow from the design rather than from policy:
   **only managed events can carry a sheet** (an imported ICS event has no
   durable handle — invariant 8); **a sheet resolves its event from
   `managed_event`, never `calendar_event`**, so it survives re-materialization
   (an occurrence edited away is reported as `orphaned`, not deleted); and
   **writes always require a session** — there is no anonymous claim path, and
   claiming for a Person requires controlling them (`isController`) or being a
   system admin. Overfill is prevented by a guarded `INSERT … SELECT … WHERE
   (count < slots)` whose `meta.changes` is checked, because D1 has no
   transaction around a read-then-write.
14. **Public sign-up is double opt-in, and `POST /newsletter-public/subscribe`
   writes no subscription.** The form at `/subscribe` is anonymous, so the
   address it carries is an unproven claim by whoever typed it. That route only
   mints a `newsletter_confirmation` (migration 0013) and mails the link;
   `POST /newsletter-public/subscribe/confirm/:token` is the ONLY path that
   touches `newsletter_subscriber` from the public side. Three rules hold it
   together. **The GET on that token must stay read-only** — mail scanners and
   "safe links" rewriters follow every GET in an email, so a confirming GET
   would verify the recipient's mail server rather than the recipient; the same
   reasoning as the unsubscribe pair, and `test/newsletterSubscribe.test.ts`
   asserts nothing is written by the GET. **The token is not an `auth_token`**:
   `/auth/callback` matches on `token_hash` without filtering `kind` and creates
   a user for any non-`signin` kind, so a newsletter token in that table would
   make a public form into an account-creation and sign-in vector. **The
   response never varies** — malformed, brand new, already subscribed and
   rate-limited all answer `{ ok: true }` (invariant 4), so the daily send cap
   can't be used as an existence oracle either.
   Admin-side adds (`/newsletter/subscribers`, bulk import) remain single
   opt-in on purpose: an admin entering the school roster is asserting a
   relationship the form can't. That split is also what
   `newsletter_subscriber.confirmed_at` (migration 0014) records, and why admin
   notifications key on it rather than on `created_at`: only the public confirm
   route stamps it, so an address an admin added can't email them about itself.
   `created_at` could not do the job — the upsert deliberately doesn't bump it,
   so a re-subscription is invisible to any window query over it.
   The notification setting itself is `newSubscriberNotify` on the newsletter
   settings blob, edited on the newsletter's own Settings screen — NOT with the
   new-member toggle in `apps/web`'s Admin, because each app owns its own admin.
   `lib/notify.ts` holds both, and the daily digests share one cron.
15. **An issue page has ONE projection and TWO gates.** Everything a reader sees
   of a newsletter issue — the public archive page and a review link alike — is
   built by `issuePageOf` (`apps/api/src/lib/newsletter.ts`), field by field,
   like `publicEventOf` and `publicSheetOf`. Never spread a row or a wider DTO
   into it: `newsletter_issue` holds `preview_token_hash`, so a spread would
   publish a live capability on an enumerable page. The two ways in are gated
   differently and deliberately — `/newsletter-public/issues/:slug` filters
   `status = 'sent'` **in SQL** (a guessed draft slug reveals nothing), while
   `/newsletter-public/preview/:token` has no status filter at all, because
   holding the token IS the authorization. Sharing a draft never required
   loosening the first gate, and must not.
   The token (migration 0015) is hashed at rest, minted only by a system admin,
   **revocable with no expiry**, and deliberately **survives a send** so a link
   already circulated keeps resolving. It is not an `auth_token`, for the reason
   migration 0013 gives. `test/newsletterIssuePage.test.ts` asserts the exact
   key set, that a widened row can't ride through, and that both gates still
   behave.
   **The pages that read a token must never be cacheable.** `/preview/:token`
   and its `/print` twin pass `cacheable: false` to `renderIssuePage`, which
   routes them through `htmlPrivate()`; a shared cache keyed on the URL would
   let a revoked link keep being served from the edge.
16. **"View as PDF" is printing, not a PDF renderer.** There is no PDF library
   or Browser Rendering binding in this project on purpose — a second renderer
   is a second place for a newsletter's look to drift from the email
   (invariant 9). The `@media print` block lives inside `NEWSLETTER_WEB_CSS`, so
   an ordinary Ctrl+P on any issue page also comes out clean; the `/print`
   routes add only the auto-firing dialog. The admin's own print view
   (`/admin/issues/:id/print`) is an SPA route rather than a Pages Function
   because the session cookie is host-only to the API and a Function on the
   newsletter origin cannot see it — see `apps/newsletter/ROUTING.md`.

17. **Removing a User is `disabled_at`, and deleting one has rules it does not
   yet execute.** `POST /admin/users/:id/disabled` is reversible and touches the
   `user` row alone — everything that matters already filters on `disabled_at`
   (session middleware, newsletter audience, masquerade), so nothing of theirs
   needs removing to cut off access. Two guards are load-bearing and both were
   found in review rather than by design: the session sweep matches
   `acting_admin_id` as well as `user_id`, because a masquerade session's
   `user_id` is the person being impersonated and a disabled admin would
   otherwise keep browsing as them for an hour; and the disable is refused
   unless another enabled system admin remains, enforced *inside* the `UPDATE`
   (D1 has no read-then-write transaction) because two admins disabling each
   other concurrently would otherwise leave an instance nobody can sign in to —
   with no route that clears `disabled_at` without an admin session, and a
   bootstrap-admin email re-granting the role but never un-disabling the row.
   **Permanent deletion is deliberately not implemented.**
   `GET /admin/users/:id/impact` is the only statement of what it would be
   allowed to touch, and if it is ever built it must execute that report rather
   than re-derive it. The rules exist because the obvious reading is wrong:
   `control` is many-to-many by design (two parents, one child), so a Person
   any *other* User controls is not this user's to take — only one left with no
   controller at all is. `grp` records no creator, so "groups they created" is
   not a thing this schema knows; a household is removed only when it would be
   left with no members, and a classroom or school group is never removed with a
   member, because it belongs to the school. `audit_log` is never deleted for
   anyone: it is append-only and hash-chained (invariant 5), so dropping rows
   both breaks tamper-evidence and erases the record of what the account did.


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
pnpm dev:home     # the apex landing page (wrangler dev) on :5176
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
