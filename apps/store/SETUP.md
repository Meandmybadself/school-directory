# Standing up the store

A runbook for connecting `store.eisenhower.school` to a Printful store and a
Stripe account. Written to be run **twice**: once against a personal Printful
and Stripe account to prove the thing works, and again when the PTO's own
accounts take over. The second run is the one this document exists for — see
[Changing accounts](#changing-accounts) at the end.

Nothing here is reversible in a dangerous way except placing real orders, which
is the last step on purpose.

---

## 0. Before you start

You need, in this order:

1. A **Printful store** with at least one product designed in their mockup
   generator. This is the gating item, and it is not software: nothing can be
   imported until a design exists upstream.
2. A **Stripe account** that can accept payments (business details submitted,
   payouts enabled). Test mode works for everything except taking real money.
3. Access to the Cloudflare account that owns `eisenhower.school`.

> ### Every secret below belongs to the API Worker, not the store's Pages project
>
> Run all `wrangler secret put` commands from **`apps/api`**. Nothing that
> touches Printful or Stripe runs in `apps/store`: its Pages Functions only
> server-render HTML and call the API over HTTP, and the single value they need
> (`API_BASE`) is already a plain var in `apps/store/wrangler.toml`. Every vendor
> call lives in `apps/api/src/lib/{printful,stripe}.ts`.
>
> Run one from `apps/store` and wrangler stops you with *"It looks like you've
> run a Workers-specific command in a Pages project."* — which is the good
> outcome. `wrangler pages secret put` would have "worked" and set a secret
> nothing ever reads.
>
> Only §4 (Cloudflare Pages) is run from `apps/store`. Everything else is
> `apps/api`.

Set `CLOUDFLARE_ACCOUNT_ID` for every `wrangler` command below — the account has
more than one, and wrangler refuses to guess in non-interactive shells:

```bash
export CLOUDFLARE_ACCOUNT_ID=c3b373ae8a90a6494e520f962bdf462b
```

---

## 1. Printful

### The token

Printful → **Settings → Developers → API tokens** → create a token.

**Scopes — check exactly two:**

- ☑ **View store products**
- ☑ **View and manage orders of the authorized store**

Leave the other six unchecked. The mapping, so the next person can verify rather
than trust this list — these are every Printful call `lib/printful.ts` makes:

| Call | Purpose | Scope it needs |
|---|---|---|
| `GET /store/products` | list designs on the admin import screen | View store products |
| `GET /store/products/{id}` | variants, prices, mockups at import and re-sync | View store products |
| `POST /orders?confirm=1` | place a paid order for fulfilment | View and manage orders |
| `POST /shipping/rates` | live shipping quote for the cart | *(see note)* |

Why the others stay off:

- **View and manage store _products_** — the code never creates or modifies a
  Printful product. That is the architecture, not an omission: Printful owns
  designs and variants; `store_product` holds only our publish flag, sort order,
  copy and price. Granting write would let a leaked token alter or delete real
  designs, buying no capability we use.
- **View orders** (read-only) — redundant under "manage", and nothing reads
  orders back anyway. The shipment webhook is trusted through a guarded
  `WHERE printful_order_id = ? AND status = 'submitted'`, never a re-fetch.
- **Store files** — no print files are ever uploaded from here.
- **Store webhooks** — the shipment webhook is registered by hand in Printful's
  dashboard (§1.3). Nothing in the code calls `/webhooks`.

> **Note on `/shipping/rates`.** It is a pricing calculation rather than a store
> resource and does not map cleanly onto any of the eight scopes. If the admin
> import screen works but the cart's "Get shipping options" returns a 403, add
> **View orders of the authorized store** and retry. Start minimal; add one.

**"Manage orders" is the grant with money attached** — it is what lets anything
holding this token place orders Printful will print and bill for. Unavoidable,
since placing orders is the job, and the reason the token goes in
`wrangler secret put` and never into the repo or a committed `.env`.

```bash
cd apps/api    # NOT apps/store — see the note in §0
pnpm exec wrangler secret put PRINTFUL_API_KEY --env production
```

### The store id

A token created through the scope picker above is **account-level**, which is
the case where Printful wants an `X-PF-Store-Id` header. The client sends it
only when the var is set, so:

- Try without it first.
- If calls fail complaining about store selection, or the import screen returns
  an empty list despite the store having products, that is the missing piece.

It is **not a secret** — it is an identifier — so it belongs in
`apps/api/wrangler.toml` under both `[vars]` and `[env.production.vars]`:

```toml
PRINTFUL_STORE_ID = "1234567"
```

Adding it there needs a commit and a deploy. Setting it with
`wrangler secret put` works identically at runtime if you need it faster, but
the var is the honest classification.

### The shipment webhook

Printful → **Settings → Webhooks**. Register:

```
https://api-directory.eisenhower.school/store-webhooks/printful?s=<shared-secret>
```

for the **package shipped** event. Generate the shared secret and set it:

```bash
cd apps/api
openssl rand -hex 16          # copy this — you need it in the URL above
pnpm exec wrangler secret put PRINTFUL_WEBHOOK_SECRET --env production
```

This one is genuinely optional. Printful's v1 webhooks are not signed the way
Stripe's are, so the query string is all the authentication there is — and the
design does not lean on it. Left unset, the endpoint accepts unauthenticated
calls, and a forged one can at worst mark one already-submitted order as shipped
and email that buyer. It cannot create an order, move money, or read anything;
the guarded transition is what bounds it.

Without this webhook, orders simply stay `submitted` and buyers get no "it
shipped" email. Everything else works.

---

## 2. Stripe

> **Register the `*/15` cron before you finish this section.**
>
> `retryStuckOrders` is the backstop that re-drives a PAID order whose inline
> submission to Printful died mid-flight. It is meant to run every fifteen
> minutes. It is currently NOT registered: the Workers **free** plan caps an
> account at five cron triggers, this one is the sixth, and asking for it fails
> the deploy at the trigger step — after the code has already uploaded. So it
> rides the 3-hourly calendar tick instead.
>
> That is tolerable only while nothing can be bought. The moment Stripe keys are
> live, a charged order can sit unprinted for up to three hours, and the
> customer has paid. To fix it: free a cron elsewhere in the account, or move to
> Workers Paid, then put `"*/15 * * * *"` back in BOTH `[triggers]` blocks in
> `apps/api/wrangler.toml`. No code change is needed — the `STORE_CRON` branch in
> `src/index.ts` is still there and still correct.
>
> Check what the account is using:
>
> ```bash
> curl -s -H "Authorization: Bearer $CF_TOKEN" \
>   "https://api.cloudflare.com/client/v4/accounts/<account>/workers/scripts/<script>/schedules"
> ```


### Keys

Stripe → **Developers → API keys** → copy the **secret** key (`sk_test_…` or
`sk_live_…`).

```bash
cd apps/api
pnpm exec wrangler secret put STRIPE_SECRET_KEY --env production
```

### The webhook

Stripe → **Developers → Webhooks** → add an endpoint:

```
https://api-directory.eisenhower.school/store-webhooks/stripe
```

Subscribe to **exactly these four**:

| Event | Why |
|---|---|
| `checkout.session.completed` | a synchronous (card) payment |
| `checkout.session.async_payment_succeeded` | a delayed method actually settled |
| `checkout.session.async_payment_failed` | a delayed method bounced |
| `checkout.session.expired` | the buyer never paid |

The middle two are not optional garnish. `checkout.session.completed` fires for
a delayed method — ACH, bank transfer, voucher — the moment the buyer finishes
the form, carrying `payment_status: "unpaid"`, with the money arriving days
later or never. The handler checks `payment_status` and refuses to fulfil on
that, waiting for `async_payment_succeeded`. Skip subscribing to it and such an
order silently never ships. See CLAUDE.md invariant 26.

Copy the endpoint's **signing secret** (`whsec_…`):

```bash
cd apps/api
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET --env production
```

> **The key and the signing secret must be from the same mode.** A live key with
> a test-mode signing secret fails every signature check and looks exactly like
> a wrong secret. Test and live have separate webhook endpoints with separate
> secrets; moving from one to the other rotates both.

---

## 3. `STORE_SECRET`

Generate it here — it comes from nobody:

```bash
cd apps/api
openssl rand -base64 32 | pnpm exec wrangler secret put STORE_SECRET --env production
```

(Piped, so it is never displayed and never enters shell history.)

**This is the one secret in the project that does not degrade gracefully.**
Every other optional secret falls back to "log it instead of sending it"; the
worst case is an unsent email. This one keys the signed shipping quote, and a
guessable quote key is a guessable **price**. So the dev fallback exists only
while `STRIPE_SECRET_KEY` is *also* absent, and the moment a Stripe key is
present this becomes mandatory: `storeSecret()` refuses to sign and
`POST /store-public/quote` returns **503**. Checkout stops, quietly.

**Set it before or alongside the Stripe key, never after.**

It also keys the derived order-status token, so **rotating it invalidates every
`/o/:token` link already emailed to a buyer**. Set it once and leave it. It is
deliberately separate from anything on the auth path for exactly this reason.

---

## 4. Cloudflare Pages

Only needed once per environment — already done for the current instance, and
recorded here because the DNS step is not what the API docs imply.

```bash
cd apps/store
export CLOUDFLARE_ACCOUNT_ID=c3b373ae8a90a6494e520f962bdf462b

# 1. The project. Must exist BEFORE CI runs — `wrangler pages deploy` will not
#    create it in a non-interactive shell, so the workflow's store step fails
#    without this. `--production-branch main` must match the workflow's
#    `--branch main`, or every deploy publishes as a preview instead.
pnpm exec wrangler pages project create school-store --production-branch main

# 2. One deployment, because a custom domain will not serve until the project
#    has something to serve. CI handles every deploy after this.
pnpm build && pnpm exec wrangler pages deploy

# 3. Attach the domain to the project.
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/school-store/domains" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"store.eisenhower.school"}'

# 4. CREATE THE DNS RECORD. This step is easy to miss and the reason step 3
#    appears to do nothing.
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/689f6323a55417c703d2b05b2c2aad31/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"CNAME","name":"store","content":"school-store.pages.dev","proxied":true}'
```

> **Step 4 is not optional, despite what the same-account rule suggests.**
> Adding a custom domain through the Cloudflare **dashboard** creates the CNAME
> for you. The **API** endpoint in step 3 only registers the domain against the
> Pages project — it creates no DNS. Without step 4 the domain sits at
> `status: pending` indefinitely, waiting on a record nothing will create, and
> the hostname does not resolve at all. Validation flips to `active` within a
> minute or two of the record existing.

---

## 5. Verify

```bash
# Domain is active, not pending
curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/school-store/domains" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -m json.tool | grep -E '"name"|"status"'

# Public surfaces
curl -s -o /dev/null -w "%{http_code}\n" https://store.eisenhower.school/
curl -s https://store.eisenhower.school/robots.txt | head -2
curl -s -o /dev/null -w "%{http_code}\n" https://store.eisenhower.school/sitemap.xml

# The token-gated order page must never be cacheable
curl -sD- -o /dev/null https://store.eisenhower.school/o/deadbeef \
  | grep -iE "^HTTP/|cache-control|x-robots-tag"
# expect: 404, "no-store, private", "noindex, nofollow"
```

Then, in the app:

1. Sign in as a system admin → **Admin** → **Add from Printful**. If the list
   loads, the token and its scopes are right.
2. Import a product, set a price per size, **Publish**.
3. Open `/` — the product should appear with "from $X".
4. Add to cart, enter an address, **Get shipping options**. If options appear,
   `/shipping/rates` is authorised.
5. **Place one real test order**, all the way through Stripe.

Step 5 is not optional. Orders auto-confirm at Printful — payment is already
captured, so there is no human review gate — which means a bad variant mapping
prints and ships for real. That one test order is the guard we chose instead of
a per-order approval step.

Watch for: the confirmation email, the order moving `paid → submitted` on the
admin Orders screen, a Printful order id appearing, and a `store.order.paid`
line in Slack.

---

## Changing accounts

Moving from a personal Printful/Stripe to the PTO's. **This is a secret rotation
plus an admin re-point — not a migration.** The schema was built for this day.

**What survives, and why:**

- **Product URLs, sort order, copy and prices.** `store_product.id` is our ULID
  and `slug` is ours; the Printful ids are a nullable *mapping* beside them.
- **Every past order.** `cart_json`, the address and the totals are frozen
  copies taken at purchase, never re-derived by joining back to `store_product`
  or re-fetching from a vendor. An order placed on the old accounts still reads
  correctly after the new ones take over.
- **Open carts.** They hold *our* variant ids, not Printful's.

**What breaks, and must be re-pointed:**

- Every `printful_sync_product_id` and every `printfulSyncVariantId` /
  `printfulCatalogVariantId` inside `variants_json`. Sync product and variant
  ids are per-store.
- `stripe_session_id` and `stripe_payment_intent_id` on old orders stop
  resolving in the new Stripe dashboard. They stay on the row as a reference —
  treat them as possibly-dead.

**Procedure:**

1. Recreate the designs in the PTO's Printful store.
2. Rotate `PRINTFUL_API_KEY` (same two scopes), and `PRINTFUL_STORE_ID` if used.
3. Re-register the Printful shipment webhook on the new store, with a fresh
   `PRINTFUL_WEBHOOK_SECRET`.
4. Rotate `STRIPE_SECRET_KEY`, create the webhook endpoint on the new account
   with the same four events, and rotate `STRIPE_WEBHOOK_SECRET`. Both together.
5. **Do not rotate `STORE_SECRET`** unless you intend to invalidate every
   order-status link already emailed. It is not tied to either vendor.
6. In Admin, for each existing product: re-point it at the new Printful design
   and **Sync from Printful**. The unique constraint on
   `printful_sync_product_id` stops two products being aimed at one design while
   you work.
7. Drain first if you can: let in-flight orders reach `shipped` before
   switching, or they will need finishing by hand in the old Printful account.

---

## Troubleshooting

**The hostname doesn't resolve at all.** Check the DNS record exists (§4 step 4).
If it does and `dig +short store.eisenhower.school @1.1.1.1` answers but your
machine says "could not resolve host", your resolver cached the NXDOMAIN from
before the record existed:

```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

**Checkout returns 503.** `STORE_SECRET` is unset while `STRIPE_SECRET_KEY` is
set. See §3 — this is deliberate, not a bug.

**Stripe webhook 400s on every delivery.** Signature mismatch. Almost always a
test/live mode mismatch between key and signing secret, or a body-parsing
middleware added in front of `routes/storeWebhooks.ts` — the handler must read
the *raw* bytes before parsing.

**Stripe webhook returns 202 and does nothing.** `STRIPE_WEBHOOK_SECRET` is
unset. The endpoint refuses to act on anything it cannot verify, and answers 202
rather than an error so Stripe does not retry for days.

**Admin import screen errors.** Token missing, wrong scopes, or an account-level
token needing `PRINTFUL_STORE_ID`.

**Cart shows shipping options but checkout fails.** Look at the admin Orders
screen — a `fulfillment_failed` order carries Printful's actual error text
(usually a discontinued variant). Fix upstream, **Sync from Printful**, then
**Retry submission**.

**An order is stuck at `paid`.** The recovery sweep re-drives it. Six failed
attempts move it to `fulfillment_failed`, which is what raises the Slack alert
and surfaces the retry button.

How long that takes depends on a cron that **is not currently registered** — see
below.

---

## Reference: everything that must be set

All of these live on the **API Worker** (`apps/api`). The store's Pages project
holds none of them — only `API_BASE`, already set in `apps/store/wrangler.toml`.

| Name | Kind | Set from | Source |
|---|---|---|---|
| `PRINTFUL_API_KEY` | secret | `apps/api` | Printful → Developers, 2 scopes |
| `PRINTFUL_STORE_ID` | var (`apps/api/wrangler.toml`) | — | Printful, only for account-level tokens |
| `PRINTFUL_WEBHOOK_SECRET` | secret, optional | `apps/api` | you generate it |
| `STRIPE_SECRET_KEY` | secret | `apps/api` | Stripe → API keys |
| `STRIPE_WEBHOOK_SECRET` | secret | `apps/api` | Stripe → Webhooks endpoint |
| `STORE_SECRET` | secret | `apps/api` | you generate it — see §3 |
| `STORE_URL` | var | — | already set in `apps/api/wrangler.toml` |
| `ALLOWED_ORIGINS` | var | — | already includes the store origin |
| `API_BASE` | var | — | already set in `apps/store/wrangler.toml` |
