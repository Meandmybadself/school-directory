# Email on eisenhower.school — intake + forwarding aliases

Cloudflare Email Routing owns the apex's mail (cut over from ForwardMX
2026-10-22). Every routed address points at the API Worker's `email` handler
(`src/email.ts`), which does two jobs:

- **Forwarding aliases** (`admin@`, `pto@`): fan out to the destinations named
  in the `EMAIL_FORWARDS` secret (`lib/emailForward.ts`). A Worker does this
  rather than plain routing rules because a rule forwards to at most ONE
  verified destination, and `pto@` goes to the whole board. The map is a
  SECRET, not a wrangler var — the repo is public and the values are board
  members' personal addresses.
- **Lost & found photo intake** (`found@`): each JPEG from a staff sender
  becomes a HELD item in the review queue (`lib/lostFoundEmail.ts`).

## The pieces (all account/zone config CI does not create)

1. **Email Routing enabled on the zone** — this is what replaced ForwardMX's
   MX records. Deliberately NO catch-all: an address nobody configured
   bounces with a 550.
2. **Destination addresses** (account-level): every address mail is forwarded
   TO must be created here, and its holder must click Cloudflare's
   verification email, or `forward()` to it throws (the handler skips it and
   delivers to the rest). Create one:
   ```
   curl -X POST "https://api.cloudflare.com/client/v4/accounts/c3b373ae8a90a6494e520f962bdf462b/email/routing/addresses" \
     -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
     -d '{"email":"person@example.com"}'
   ```
   (Needs Account → Email Routing Addresses: Edit on the token.)
3. **Routing rules** (zone-level): `found@`, `admin@`, `pto@` each route to
   the Worker `school-directory-api-production` (action type `worker`).
   Needs Zone → Email Routing Rules: Edit.
4. **`EMAIL_FORWARDS` secret** on the API Worker:
   ```
   cd apps/api && npx wrangler secret put EMAIL_FORWARDS --env production
   # value: {"admin":["meandmybadself@gmail.com"],"pto":["…","…"]}
   ```

## Adding the PTO board to pto@

Two steps per person: create their destination address (step 2 above — this
immediately sends them a "verify your email" message from Cloudflare, so warn
the board first), then add their address to the `pto` list in the
`EMAIL_FORWARDS` secret. Order doesn't matter: an unverified destination is
skipped, not fatal, and starts receiving as soon as they click verify.

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

- The apex previously used **ForwardMX** (`mx1/mx2.forwardmx.net`); any alias
  that existed only there died at cutover, by choice (no catch-all). The old
  apex SPF (`include:_spf.forwardmx.net`) was replaced by Cloudflare's.
- Outbound transactional mail (Resend, `EMAIL_FROM`) sends from
  `mailer.meandmybadself.com` and is unaffected by any of this.
