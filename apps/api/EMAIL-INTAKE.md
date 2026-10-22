# Lost & found photo intake by email — setup

Staff mail a photo (or several) to the intake address and each JPEG becomes a
HELD lost & found item, described by the model, waiting in the staff review
queue. The code half ships with the Worker (`src/email.ts`,
`src/lib/lostFoundEmail.ts`); this file is the by-hand half — Email Routing is
account/zone configuration CI does not create, like the Pages custom domains.

## Why a subdomain

`eisenhower.school` already receives mail: its MX records point at ForwardMX,
which forwards the PTO's addresses. Cloudflare Email Routing needs the MX of
whatever domain it serves, so enabling it on the APEX would replace ForwardMX
and break those forwards. Email Routing can instead be enabled on a
**subdomain** of the zone, which touches nothing at the apex. The intake
address is therefore:

```
found@mail.eisenhower.school
```

(If the PTO ever migrates ForwardMX's forwards into Cloudflare Email Routing,
the address can move to `found@eisenhower.school` by adding an apex rule — the
Worker doesn't care which address was routed to it.)

## Steps (Cloudflare dashboard, zone `eisenhower.school`)

1. **Compute & AI → Email Service → Email Routing** → select the zone and
   enable Email Routing if it isn't already. Do NOT accept any prompt to add
   MX records to the apex — skip straight to settings if offered.
2. **Settings → Subdomains** → add `mail`. Cloudflare creates the MX + SPF
   records on `mail.eisenhower.school` itself; wait for them to show in DNS.
3. **Routing rules** → create a custom address `found@mail.eisenhower.school`
   with the action **Send to a Worker** → `school-directory-api-production`.
   (Catch-alls exist only on the apex; the literal address is all we want.)
4. Send a test photo from a staff member's address and check:
   - the item appears under Review in the staff app (held, then described);
   - the confirmation reply arrives (sent via Resend, from `EMAIL_FROM`);
   - a non-staff sender gets an SMTP rejection, and nothing is created.

## What the Worker enforces (lib/lostFoundEmail.ts)

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

## Bindings involved

- `IMAGES` (wrangler.toml): makes the thumbnail the app's canvas would have
  made. Optional — absent, the model reads the full photo and listings use it
  as the thumb. Billed per unique transformation (one per photo); a school's
  volume sits inside the free monthly allowance.
- Inbound messages over Email Routing's 25 MiB cap never reach the Worker.
