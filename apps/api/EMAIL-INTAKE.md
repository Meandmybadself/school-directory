# Email on sitemail.eisenhower.school — intake + forwarding aliases

The APPLICATION's mail — both directions — lives on the dedicated subdomain
**`sitemail.eisenhower.school`**. The apex's mail (`…@eisenhower.school`) is
the SCHOOL's, moving to Google Workspace: people-mailboxes and human aliases
belong there, and Google owning the apex MX means nothing of the app's can sit
on it. One subdomain, three jobs:

- **Inbound** (Cloudflare Email Routing, enabled per-subdomain on the zone):
  routed addresses point at the API Worker's `email` handler (`src/email.ts`).
- **Outbound bulk** (Cloudflare Email Sending): the newsletter channel —
  `BULK_EMAIL_FROM = newsletter@sitemail.eisenhower.school` (wrangler.toml).
- **Outbound transactional** (Resend, `EMAIL_FROM` secret): magic links,
  invites, admin notifications, the intake's confirmation replies.

The Worker's `email` handler does two jobs, keyed on the LOCAL PART only
(`forwardsFor` never looks at the domain, so the same handler served the apex
before the move and serves sitemail now):

- **Forwarding aliases**: fan out to the destinations named in the
  `EMAIL_FORWARDS` secret (`lib/emailForward.ts`). A Worker does this rather
  than plain routing rules because a rule forwards to at most ONE verified
  destination. The map is a SECRET, not a wrangler var — the repo is public
  and the values are board members' personal addresses.
- **Lost & found photo intake** (`found@sitemail.eisenhower.school`): each
  JPEG from a staff sender becomes a HELD item in the review queue
  (`lib/lostFoundEmail.ts`).

## The pieces (all account/zone config CI does not create)

1. **Email Routing enabled for the subdomain** — registered on the zone
   (dashboard: Email Routing → Settings → Subdomains; API:
   `POST /zones/:id/email/routing/dns {"name":"sitemail.eisenhower.school"}` —
   note `$CF_TOKEN` lacks that scope; wrangler's OAuth token has it). This
   mints the subdomain's own `route1-3.mx.cloudflare.net` MX + SPF records.
   Deliberately NO catch-all (and Email Routing doesn't offer one on a
   subdomain anyway): an address nobody configured bounces with a 550.
2. **Email Sending onboarded for the subdomain** —
   `npx wrangler email sending enable sitemail.eisenhower.school` (wrangler
   OAuth; done + verified by test send 2026-10-25). Auto-creates the
   `cf-bounce.sitemail` MX/SPF, the `cf-bounce._domainkey.sitemail` DKIM and a
   `_dmarc.sitemail` `p=reject` — all in the zone already.
3. **Destination addresses** (account-level): every address mail is forwarded
   TO must be created here, and its holder must click Cloudflare's
   verification email, or `forward()` to it throws (the handler skips it and
   delivers to the rest). Create one:
   ```
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/c3b373ae8a90a6494e520f962bdf462b/email/routing/addresses" \
     -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
     -d '{"email":"person@example.com"}'
   ```
   (Needs Account → Email Routing Addresses: Edit on the token.)
4. **Routing rules** (zone-level, needs Zone → Email Routing Rules: Edit):
   literal rules routing each address to the Worker
   `school-directory-api-production` (action type `worker`). Live today:
   `found@sitemail.eisenhower.school`.
5. **`EMAIL_FORWARDS` secret** on the API Worker:
   ```
   cd apps/api && npx wrangler secret put EMAIL_FORWARDS --env production
   # value: {"admin":["meandmybadself@gmail.com"],"pto":["…","…"]}
   ```

## Apex cutover to Google Workspace (the remaining by-hand steps)

Until the cutover, the OLD apex rules (`found@`, `admin@`, `pto@` → same
Worker) keep working alongside sitemail. Cutover day, in order:

1. Create the Google Workspace org on `eisenhower.school`; re-home the human
   aliases there (`admin@`, `pto@` as Google Groups — that replaces the
   Worker's fan-out for apex addresses).
2. Delete the three apex routing rules, then disable Email Routing **for the
   apex only** (dashboard — Settings → the apex domain row; leave the
   `sitemail` subdomain registered). This frees the apex MX records.
3. Retire the apex's Email Sending onboarding (`wrangler email sending
   disable eisenhower.school`) once `BULK_EMAIL_FROM` no longer names it —
   it hasn't since 2026-10-25.
4. Set the apex DNS Google's way: MX → `smtp.google.com` (1), SPF TXT
   `v=spf1 include:_spf.google.com ~all` (replacing the Cloudflare include),
   Google's DKIM via Admin console. Mind `_dmarc.eisenhower.school` — it is
   `p=reject` today; don't put Google in front of it until Google's DKIM is
   signing.
5. Tell the lost & found staff the intake address is
   **found@sitemail.eisenhower.school** (mail to the old `found@` will
   land in Google's world and bounce or sit unread).

Nothing in the app changes on cutover day — every address it uses already
lives on `sitemail` or a third party.

## Adding the PTO board to the pto alias

Two steps per person: create their destination address (step 3 above — this
immediately sends them a "verify your email" message from Cloudflare, so warn
the board first), then add their address to the `pto` list in the
`EMAIL_FORWARDS` secret. Order doesn't matter: an unverified destination is
skipped, not fatal, and starts receiving as soon as they click verify.
(If the board lands on Google Groups at cutover instead, skip all of this and
leave `EMAIL_FORWARDS` for any future sitemail alias.)

## What the Worker enforces for found@ (lib/lostFoundEmail.ts)

- Sender must be an **enabled account on the lost & found staff roster**
  (`lostfound_staff_group_id`, invariant 31/33) — matched on the ENVELOPE
  sender, checked before the body is parsed. No group configured → system
  admins' addresses only, the same bootstrap as the routes.
- An explicit SPF/DKIM/DMARC **fail** in Cloudflare's Authentication-Results
  header is rejected even for a staff address. Softer verdicts (none,
  softfail, no header) are admitted — the hold bounds a forgery — but each
  item's audit row records the DMARC verdict it arrived under, so a row
  minted by envelope forgery is identifiable. Requiring `dmarc=pass` is a
  one-line tightening, documented at `authFailed`.
- JPEG attachments only (magic bytes, the upload route's own sniff), ≤ 6 MB
  each, at most 10 per message (the reply says to send the rest separately);
  the subject line becomes the item's `location` ("Fwd: gym" → "gym").
- Every item starts **HELD** (invariant 33) — email changes who can submit,
  never what the public sees without a staff Publish.
- The confirmation reply is marked `Auto-Submitted: auto-replied` and is
  never sent in answer to machine-generated mail (out-of-office, forwarding
  rules), so no mail loop can form.

The forwarding aliases deliberately get NONE of that gauntlet — a forwarding
alias behaves like a plain routing rule, which forwards whatever Cloudflare
accepted.

## Bindings involved

- `IMAGES` (wrangler.toml): makes the thumbnail the app's canvas would have
  made. Optional — absent, the model reads the full photo and listings use it
  as the thumb. Billed per unique transformation (one per photo); a school's
  volume sits inside the free monthly allowance.
- Inbound messages over Email Routing's 25 MiB cap never reach the Worker.

## History / gotchas

- 2026-10-25: app mail moved from the apex to `sitemail.eisenhower.school`
  so the apex MX could be handed to the school's Google Workspace. The
  handler needed no change (local-part matching).
- 2026-10-22: Cloudflare Email Routing took the apex from **ForwardMX**
  (`mx1/mx2.forwardmx.net`); any alias that existed only there died at
  cutover, by choice (no catch-all). The old apex SPF
  (`include:_spf.forwardmx.net`) was replaced by Cloudflare's.
- Outbound transactional mail (Resend, `EMAIL_FROM`) historically sent from
  `mailer.meandmybadself.com`; it moves to a sitemail sender once the domain
  is verified in Resend (dashboard — the stored API key is send-only).
- Testing a forward by mailing yourself from Gmail LOOKS like it failed:
  Gmail dedupes the returning copy by Message-ID; check `wrangler tail` for
  the `Email … - Ok` line instead.
