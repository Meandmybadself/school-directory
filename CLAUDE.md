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
  strip it. A stable per-language URL is what `hreflang` and a shared link both
  need. Outbound links to the apps carry `?lang=` so the reader's language
  travels with them.
- **Language resolves `?lang=` → `sd_lang` cookie → `Accept-Language` → `en`**
  (`locale.ts`), the server-side twin of `detectLocale` in each SPA's
  `src/i18n/index.tsx`, which reads `?lang=` → localStorage →
  `navigator.language`. The order is the rule: a choice, once made, is never
  quietly undone by detection. The cookie is written **only where an explicit
  `?lang=` was honoured** — a detected language is never written back, so
  detection can't promote itself into a preference the reader never stated. It
  is the only state this page keeps; it is host-only (no `Domain`, like
  `sd_session`), and the SPAs don't read it — the `?lang=` on every outbound
  link is the handoff, and each app then saves the choice its own way. Because
  the response now varies on a cookie it is `Cache-Control: private` with
  `Vary: Accept-Language, Cookie`: a shared copy would hand the next reader the
  previous one's language. Crawlers send no cookie, so canonical and `hreflang`
  are unaffected.

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
- **It repeats the contacts and links a family reaches for**, transcribed from
  the district's back-to-school mailing into `apps/home/src/district.ts` — phone
  numbers, URLs and the bell times, since the words that label them are
  dictionary keys like everything else. The school's NAME lives there too: a
  proper noun, configuration in the same sense `SCHOOL_CITY` is. Nothing in that
  file expires, which is why it may be transcribed at all. Three columns —
  Eisenhower's own numbers, the district's departments, the pages worth opening
  — and deliberately nothing else: the other schools' offices and the "published
  by" attribution were both cut as reprinting rather than helping, so keep
  additions to that bar. The district is already reachable from the header and
  from every resource row.

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
- **A volunteer sheet no longer has a page of its own.** It is rendered inline
  on its event's page (below), and `/v/:slug` resolves the slug and forwards
  there — ungated, same pattern, and it picks its endpoint by whether there's a
  session (the anonymous one when signed out: counts, no names). The URL is kept
  permanently: it is what circulates in text messages, and a slug is the only
  DURABLE handle on a sheet, where an event path is a content identity a retitle
  invalidates. It forwards the slug in `?sheet=`, which the event page honours so
  a sheet the event itself would not name still opens — a draft, or one whose
  occurrence no longer resolves (which is also the one case the admin's share
  link stays a `/v/` URL). A param-sourced sheet is checked against the path's
  own slug before it renders, since a hand-edited URL could otherwise pair one
  event's heading with another's positions. Signing up is a write and always
  needs an account. See invariant 13.
- **And so is one event's own page at `/e/:date/:slug`.** Tapping a row on the
  agenda goes there rather than opening a modal, and it is the ONE page where the
  description, the volunteer sheet (via `components/VolunteerPositions.tsx`) and
  the admin edit form all live — the sheet's own screen was folded into it, so
  there is one rendering of an event rather than two that overlap. There is
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
   The append is a **compare-and-swap on `seq`** (migration 0016), not a
   read-then-write: reading the tail and inserting a successor are two
   statements with no transaction between them, and the flush runs inside
   `waitUntil`, so concurrent requests really did both chain onto row N and fork
   the chain into a tree. A writer claims a position, `ON CONFLICT (seq) DO
   NOTHING` rejects the loser, and it re-reads and chains onto the winner.
   Exhausting the retry budget DROPS an entry, which is worse than the fork —
   that is why the budget is 25 with jittered backoff and not a token 3.
   `verifyAuditChain` is the other half: `prev_hash`/`row_hash` were written and
   read by nothing for a long time, which is exactly why the fork went unnoticed
   — a hash nobody checks is not evidence. It's exposed at
   `GET /admin/audit/verify`. Rows appended before 0016 may legitimately fail it.
   **Noise is fixed at the push site, never by deleting rows.** The chain is
   append-only and `lib/sweep.ts` deliberately omits `audit_log`, so a log gone
   loud has exactly one lever: what a route decides counts as an event.
   `newsletter.issue.updated` is the worked example — the editor autosaves 1.2s
   after the author stops typing, which made it the largest action in this
   instance's log (108 rows out of ~450, from ONE issue) and a transcript of a
   debounce timer rather than a record. `claimEditSession`
   (`routes/newsletter.ts`, migration 0020) now mints one row per editing
   SITTING: a guarded `UPDATE … WHERE audit_session_at < ?` on the issue row,
   batched with the save it already sends, and the draft is pushed only when
   `meta.changes` says this request opened the session. Same idiom as the
   volunteer overfill and last-admin guards, for the same reason — D1 has no
   read-then-write transaction. Nothing is lost that the system doesn't already
   hold: the row carried no `detail`, and where the sitting ended is
   `newsletter_issue.updated_at`. The state lives on the issue row rather than
   being derived from `audit_log` because audit rows are written in `waitUntil`
   AFTER the response, so a lookup there would race the burst it collapses.
   Before applying this to another action, check it is actually machine-paced:
   invariant 22's rule holds here too — **count first**
   (`SELECT action, COUNT(*) FROM audit_log GROUP BY action`), because
   coalescing a human-paced action loses real events for nothing.
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
   A sheet is READ on the event's page and nowhere else; `/v/:slug` forwards
   there (see "Three front ends, one API" above), which is why the two endpoints
   are now picked between by `screens/Event.tsx` and the redirect rather than by
   a page of the sheet's own. Three further rules follow from the design rather
   than from policy:
   **only managed events can carry a sheet** (an imported ICS event has no
   durable handle — invariant 8); **a sheet resolves its event from
   `managed_event`, never `calendar_event`**, so it survives re-materialization
   (an occurrence edited away is reported as `orphaned`, not deleted); and
   **writes always require a session** — there is no anonymous claim path, and
   claiming for a Person requires controlling them (`isController`) or being a
   system admin. Overfill is prevented by a guarded `INSERT … SELECT … WHERE
   (count < slots)` whose `meta.changes` is checked, because D1 has no
   transaction around a read-then-write.
   The same foreign key is what makes **deleting an event a cascade**, and it is
   the one direction the "survives re-materialization" rule does NOT cover: a
   sheet outlives an occurrence, but not its series. `deleteManagedEvent` and
   `deleteManagedCalendar` therefore run **`sheetCascade`** (`lib/volunteers.ts`,
   shared with `deleteSheet`) at the FRONT of their own batch — signups,
   positions, sheets, then the event. Skip it and the outcome is either a
   constraint failure or, worse, silence: `sheetRow` joins `managed_event`, so
   orphaned signups stay in the table invisible to every read. Both deletes count
   what they are about to remove BEFORE removing it — the route puts those counts
   on the audit row, and the admin is shown them in a confirmation, because a
   deleted signup is not recoverable and not countable afterwards.
   `ManagedEventDTO.sheetCount`/`signupCount` are what the confirmation reads;
   they are admin-only, and adding them touched no public projection.
   `test/managedEventDelete.test.ts` pins the order and the pre-count.
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
   both breaks tamper-evidence and erases the record of what the account did —
   which is also why `audit_log` is deliberately absent from `lib/sweep.ts`.

18. **A search may not match on more than it renders.** `person.last_name` is
   shown as an initial when `last_name_visibility = 'initial'`, and a naked
   `lower(last_name) LIKE ?` handed that back as an oracle: type "ruiz", see
   whether Dana R. comes back, and the hidden surname is confirmed — with
   `COUNT(*)` over the same WHERE leaking it before a row is even built. Every
   name search therefore goes through **`personSearchSql`**
   (`apps/api/src/lib/privacy.ts`), which conjoins the surname term with the
   display rule plus the controller exemption. It backs the directory listing
   AND its total, the share-target picker and the group add-member picker; there
   is deliberately no second copy of that predicate. Group admin is authority
   over a roster, not over a name, so the pickers get no exemption.
   `test/privacyRoutes.test.ts` asserts all four statements carry the guard.
   The same rule generalises: before adding a search, ask what the response
   withholds, and make sure the WHERE withholds it too.
   The directory's **capability filter** (`?capability=teacher&capability=staff`,
   OR'd into one `IN`) is the worked example of a term that clears this bar
   rather than tripping it: every capability a Person holds is already rendered
   as a tag on the very row the filter selects, so there is nothing for matching
   on it to confirm. It is ANDed onto `personSearchSql`, never in place of it, so
   the enumeration gate (invariant 21) and the surname rule both still apply —
   and onto BOTH statements, because a total that ignored the filter would page
   past the end of the list the member can see. It is written as a trailing
   fragment appended inside each `prepare` template rather than folded with the
   search into one `where` local, so `${search.sql}` stays visible to
   `test/personListable.test.ts`'s scan; a second local would read to that scan
   as an unguarded listing. An unrecognised code is a **400**, not a dropped
   term: dropping it answers a filtered request with the whole roster.

19. **The two ways in from an email are read-only GETs.** Mail scanners and
   "safe links" rewriters follow every GET in a message before the recipient
   sees it, so a GET that spends a single-use token hands the use to the scanner
   and shows the member an expired link — on those tenants, every time.
   Invariant 14 states this for the newsletter's confirm link; **`/auth/callback`
   has the same shape and takes the same answer.** The GET validates the token
   and renders one small self-contained page (`signInHandoffPage`, the only HTML
   this API serves) whose form POSTs it back; a browser auto-submits, a scanner
   runs no script and issues no POST. `POST /auth/callback` does all the writing,
   and claims the token INSIDE the UPDATE (`AND consumed_at IS NULL`, checking
   `meta.changes`) for the reason invariants 13 and 17 give.
   `/auth/start` also carries a send budget — per address and instance-wide,
   counted the way invariant 14 counts, with the response unchanged either way
   so the cap is no more an oracle than the rest of the route.
   **A rate limit that counts rows drags two more things along with it**, and
   the first version of this one shipped without either: an index for the count
   (`auth_token (kind, created_at)`, migration 0017 — without it every sign-in
   attempt scanned the table) and a sweep so the table doesn't grow forever.
   Where such a sweep's retention exceeds the counting window it is a SECURITY
   parameter, not housekeeping — see `lib/sweep.ts`, which is where all four
   growing tables are swept from, and which spells out which two of them are
   load-bearing that way and why neither may key its age test on `expires_at`.

20. **`/photos/:key` is members-only.** It is the only route serving `PHOTOS`,
   the objects are photographs of children, and a ULID key is not an access rule
   — a URL in a cache, a referrer or a screenshot would make one permanently
   public with no way to revoke it. `sd_session` is host-only to the API and
   every SPA is a same-site subdomain, so an ordinary `<img src>` carries the
   cookie; `fetchPhotoForVCard` already passed `credentials: "include"`. Nothing
   anonymous serves a photo URL — `publicEventOf`, `publicSheetOf` and
   `issuePageOf` all omit it, and newsletter images live in a separate bucket
   (see `NEWSLETTER_MEDIA`) precisely so the public media route can't reach one.


21. **Whether a Person exists to a viewer is decided before any field on them
   is.** `unlisted_at` (migration 0018) takes a Person off the roster for every
   ordinary member while leaving them visible to a system admin and to any User
   who controls them — `control` is many-to-many, so "controls" already names
   the right set. It is a stronger withholding than any per-item `visibility` a
   Controller sets, which is why only a system admin may move it
   (`POST /persons/:id/unlisted`); a Controller SEES the flag on their own
   Person — `buildProfile` returns `unlisted` to them and the profile screen
   shows them the card without the button — and cannot flip it. Telling them
   matters: a family missing from the directory with no explanation is the
   confusing outcome, not the private one.
   The seam is **`personListableSql`** (`apps/api/src/lib/privacy.ts`), the
   counterpart to `canSeeItem`: `canSeeItem` decides whether one contact item is
   visible on a Person already in view, this decides whether the Person is in
   view at all. **`personSearchSql` is built ON it, not beside it** — a call site
   that remembered the surname rule and forgot this one is exactly the failure
   invariants 12, 13 and 18 were each written after, so name search cannot be
   spelled without the gate. The consequence to know: an empty query used to
   return `"1"` and now returns the gate, because "no search term" is precisely
   the unfiltered listing an unlisted Person must stay out of.
   Two places do not use the SQL form, both deliberately. `buildProfile` bakes it
   into its single-row WHERE so an unlisted Person **404s** for a member who
   guessed the ULID — hiding someone from a listing while still serving their
   profile is invariant 18's oracle one URL along. And `lib/volunteers.ts`'s
   `positionsOf` lets the row survive the query and drops it in memory with
   **`isPersonListable`**, because a position's `filled` must still count an
   unlisted signer on the very response that hides their name; a count that
   shrank with the name would advertise a taken shift as needing help.
   `test/personListable.test.ts` is the tripwire, and it is a different kind of
   test from anything else here: it SCANS `apps/api/src` for `FROM person` /
   `JOIN person` and fails unless each one composes the guard or carries an
   `// UNLISTED-EXEMPT: <reason>` (a file may carry `UNLISTED-EXEMPT-FILE:`).
   Route-pinned tests only catch a listing somebody remembered to test; this
   catches the eighth one nobody did. It is detection, not prevention — a view or
   a dynamic table name would slip past, the same ceiling `verifyAuditChain` has.
   **Group-level hiding is deliberately not built**, and two counts are the
   accepted price. `GET /groups` lets any member search every group's name and
   see a raw `member_count`, and a group detail's `children[].memberCount` is
   likewise a plain `membership` count — so a household of entirely unlisted
   Persons is discoverable by NAME, with a roster that renders empty beside a
   count that doesn't. (The group's OWN `memberCount` is filtered, being derived
   from the roster rows.) Numbers, never identities. `unlisted_at` withholds a
   Person, not a Group; extending it to `grp` is a second flag for when a real
   case asks, not before.

22. **Slack is the first OUTBOUND boundary, and what may cross it is decided by
   a type, not by care.** Every projection above this one — `publicEventOf`,
   `publicSheetOf`, `issuePageOf` — withholds data from a less-privileged reader
   INSIDE this system. A Slack channel is a third party: its own retention, its
   own search, its own export, and a membership list that grows later without
   asking us. So a value that is safe in `audit_log`, which only a system admin
   reads through a route we control, is not thereby safe to send there. The seam
   is **`slackLinesOf`** (`apps/api/src/lib/slackNotify.ts`), fed from the one
   place every system event is already known — the `waitUntil` in
   `middleware/audit.ts`, on its own promise beside `writeAudit` so neither
   effect can fail the other. Two mechanisms hold it, and **neither is a rule
   anyone has to remember**:
   `FORMATTERS` is a curated `Partial<Record<AuditAction, …>>`, so an action
   with no entry sends nothing — the default for every action in the union,
   **including one added to it next year** (invariant 12's property, transplanted;
   `satisfies` still catches a misspelling); and a formatter's input type has
   **no `detail` field at all**. That second one is the whole defence against
   forwarding the raw blob: there is nothing to forward, because it is not in
   scope. `calendar.source.created` is the case that forced it — it puts the
   feed's `url` in `detail`, and invariant 12 says that may be a secret
   Google/Outlook subscribe link.
   What a formatter may say instead comes from **`AuditDraft.notify`**, a second
   bag a route fills in by hand, by name, at the push site. It is deliberately
   not `detail`: reusing that column would make "is this safe to export?" a
   judgement every future push site must get right unaided, which is the failure
   this whole entry is written after. `notify` is **never persisted** —
   `chainHash` and `writeAudit` don't read it and `audit_log` has no column for
   it — so it needed no migration, and it carries scalars only. A formatter that
   wants a NAME must look it up through **`personLabel`**, which composes
   `personListableSql(NO_VIEWER, false)`: the channel is nobody, so an unlisted
   Person's row never comes back and renders as "A member" (invariant 21). It
   reports a withheld Person and a nonexistent one identically, or the channel
   becomes an oracle for the flag; and `filled` still counts them, for the reason
   invariant 13 gives. Because it composes the seam, this is a GUARDED read of
   `person`, spending none of `test/personListable.test.ts`'s exemption budget
   (7 of 8 were already gone).
   **Know what that scan cannot catch**: `personListableSql(x, true)`
   short-circuits to the literal `"1"`, which reads like a guard, satisfies the
   scan, and gates nothing. Two independent designs for this feature made exactly
   that mistake. `test/slackNotify.test.ts` is therefore behavioural, not
   textual — its fake D1 honours the predicate, so a guard that collapsed to
   `"1"` fails it with a real name in the message. It also asserts that an
   invented future action sends nothing, that the deliberately-excluded actions
   still send nothing, and that a `detail.url` never appears in a rendered line
   even when `notify` is absent.
   **Wanting a richer message must never move the push.** A draft is pushed the
   moment its write commits; anything only a later read can supply is merged
   into `notify` afterwards, in place, on the object the array already holds
   (`routes/volunteers.ts` is the worked example — the position's name and
   counts come from the sheet the response reloads anyway). Pushing after that
   read instead reads perfectly naturally and is wrong: the read can fail on its
   own, and then a spot that really was claimed has no audit row and no
   notification. Nor does "a throwing handler skips the flush anyway" rescue it
   — Hono's `compose` wraps each handler in its own try/catch and, with
   `onError` set, turns the throw into a response AT THAT FRAME, so
   `auditMiddleware`'s `await next()` resolves and flushes whatever was already
   pushed. Pushing early genuinely saves the record. `test/
   volunteerSignupAudit.test.ts` fails if either route is reordered.
   Delivery is fire-and-forget and coalesced to ONE post per request (`c.var.audit`
   is already the batch). A dropped message is cosmetic where a dropped audit row
   is not, which is why the two share no machinery — no outbox, no retry, no
   cron. `SLACK_WEBHOOK_URL` is a secret, absent by default (feature off, message
   logged, mirroring `RESEND_API_KEY`), and never logged even on failure: holding
   it is the capability to post into the channel.
   **The allowlist was set too narrow the first time, and the fix came from
   counting rather than reasoning.** It originally excluded authoring CRUD on
   the theory that it fires once per HTTP REQUEST — true, and coalescing only
   merges drafts WITHIN a request, so a sheet with six positions really is six
   messages. But nobody measured. Thirty days of this instance's `audit_log`
   said `calendar.event.*` ran 3, `volunteer.sheet.*` ran 3, roster ops ran 17,
   and the shipped list would have posted **about four messages in a month** —
   a channel nobody would look at. Everything in that theoretical second family
   except the newsletter autosave is now curated. Before narrowing this list on
   a noise argument, run the count: `SELECT action, COUNT(*) FROM audit_log
   WHERE created_at > date('now','-30 day') GROUP BY action`.
   What stays out, and why: routine member FIELD edits (`person.updated`,
   `contact.*`, `share.*`) — a parent fixing their own phone number is not news;
   `auth.signin`/`auth.signout` — every visit, where `auth.registered` is the
   one arrival; and `newsletter.issue.updated` — once the loudest action in the
   log because it fired on every autosave, now one row per editing sitting
   (invariant 5, migration 0020) and still out, since opening a draft is not
   news to a channel and the send already speaks.
   **One curated action deliberately declines most of its instances**:
   `control.granted` returns null when `notify.self` is true, because
   `person.created` reported the same act from the same request and 22 of 22
   real grants are self-grants. It speaks only for a second parent gaining
   control by invitation — rarer, and the case where "who can see this family's
   data" actually changed.
   **The line the first family draws is arrival, not existence**: `auth.signin`
   fires every time somebody opens the app and stays off, while `auth.registered`
   fires once in an account's life and is on; the same split separates
   `person.created` from `person.updated`.
   Those two actions are **new**, and adding them fixed a gap in this log rather
   than only feeding Slack: a `user` row created by /auth/callback and a Person
   created by `POST /me/persons` were both invisible here, while every later edit
   to either was recorded. `auth.registered` has a null actor by construction
   (nobody is signed in yet — like `newsletter.subscribed`), and is pushed at the
   INSERT rather than beside the `auth.signin` that follows it, for the ordering
   reason above. `person.created` is deliberately NOT pushed by `bulkImport.ts`:
   `bulk.import` already reports the batch, and one draft per row would make a
   200-child import 200 entries saying nothing the summary doesn't.
   `admin.action` speaks **six** of its ~15 ops (the four user/admin ones plus
   `user.create` and `group.create`); the rest — renames, reparents, roster
   edits, `bootstrap_admin` — fall through its switch's default and say nothing,
   which is what stops that one action readmitting the noise the allowlist
   exists to exclude.

23. **A newsletter is translated by linking out, never by us — and only its
   PUBLIC page may be linked.** Invariant 6 says member-entered content is never
   translated, and an issue's body is exactly that: nobody here is going to
   hand-write a Somali edition of every issue, so the honest offer is a free
   machine translation the reader can clearly see is a machine's. The seam is
   `packages/shared/src/newsletterTranslate.ts`, and it is a third-party
   OUTBOUND boundary in invariant 22's sense with one difference that decides
   everything: the proxy has to FETCH the url from Google's own servers, so the
   url itself is what crosses. Invariant 10 already makes a sent issue's archive
   page public and enumerable, so nothing crosses that wasn't on the open
   internet — which is precisely why **a review-token url may never appear in
   one** (invariant 15: the token IS the authorization, it is revocable, and its
   pages are `no-store` so a cache can't outlive a revocation; posting one to a
   caching proxy undoes that in a click). `renderNewsletterIssuePageHtml` takes
   `issueUrl`, REQUIRED rather than defaulted so a fifth issue-page route has to
   state its answer, and exactly one of the four surfaces passes a value:
   `/n/:slug`. Both print views and both `/preview/:token` pages pass `""`.
   `translateProxyUrl` is the second guard, and it refuses by construction
   rather than by care — not-https, a port, credentials, a dotless host and a
   relative path all return null, so local dev and the composer's preview drop
   the bar instead of offering links a proxy could never fetch.
   **The email and the page deliberately carry DIFFERENT link forms**, and this
   is the part that looks like duplication and isn't. The email gets
   `?lang=xx` on our own origin, because a sent issue is immutable and its links
   are permanent (invariant 10): a url mailed today is clicked from an inbox in
   two years and cannot be edited, so naming `translate.goog` in it would make
   Google's url scheme a thing this project can never change. The redirect that
   resolves it lives in `apps/newsletter/functions/n/[slug].ts` and is the one
   place the service is chosen. The PAGE names the proxy outright, because it
   must: **Google's fetcher forwards a proxied page's query string to the origin
   verbatim** (measured against a request echo, not assumed — it strips only its
   own `_x_tr_*`), so a `?lang=` link clicked from INSIDE the proxy would ask the
   proxy to fetch a url that redirects back into the proxy. Same reason the
   redirect's target carries no `lang` of its own. Google rewrites same-site
   hrefs to keep a reader inside it but leaves external ones alone, so a
   `translate.goog` href is what makes switching languages work in-proxy.
   The bar emits **no copy at all** — its links are the language names from
   `localeNames`, each in its own language. That is not a style choice: an
   English label like "Read this in another language" is legible only to the
   readers who least need it, and it would put hardcoded English on the one
   surface aimed at people who don't read English. Adding a locale to `LOCALES`
   adds a link for free, the way it adds a line to the front door's hero;
   `PROXY_LANG` is the one place a locale's code has to be restated, since the
   proxy names the script (`zh-CN`) where we name the language.
   `test/newsletterTranslate.test.ts` pins the exclusions, and its last case is
   deliberately the uncomfortable one: it asserts that a token url handed to
   `translateProxyUrl` WOULD produce a link, so the `""` at the four call sites
   is understood as load-bearing rather than tidy.

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
