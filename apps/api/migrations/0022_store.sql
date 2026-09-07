-- 0022_store.sql — the school store (apps/store, store.eisenhower.school): a D1
-- overlay on Printful's synced catalog, and the orders that overlay sells.
--
-- Two tables, deliberately. There is no quote table (a shipping quote is an
-- HMAC-signed token — see lib/storeQuote.ts for why a single-use, 30-minute,
-- one-consumer value that nothing joins or counts does not earn a row), no
-- order-line table (line items are frozen JSON, read back only as a whole, the
-- same relationship newsletter_issue.content_json has to its issue), and no
-- webhook-event ledger (every state transition is a compare-and-swap on
-- `status`, so a redelivered webhook finds nothing to change — see below).
--
-- ALL MONEY IS INTEGER CENTS. Every *_cents column, and every priceCents inside
-- variants_json and cart_json, is a whole number of cents in `currency`. Nothing
-- in this feature may hold a price as a float: the rounding is not recoverable
-- and the value is money.
--
-- ── store_product ──────────────────────────────────────────────────────────
--
-- The overlay. Printful owns the design, the variants, the mockups and the
-- wholesale cost; this table owns only what the PTO decides — whether it is for
-- sale, where it sorts, what it is called, what it says, and what it costs a
-- family. "Add an item" is an INSERT here (importing a Printful sync product);
-- "remove an item" is `published_at = NULL`, never a DELETE, the same nullable-
-- published idiom volunteer_sheet uses (migration 0012) and for a stronger
-- reason: an order's cart_json has already frozen everything it needs, so
-- nothing about order history depends on this row — but the row is what makes
-- re-publishing a seasonal item next year a click instead of a re-import.
--
-- `id` is a ULID and is DURABLE, which is the one place this table differs from
-- the derived cache invariant 8 describes. calendar_event is delete-then-
-- inserted on every refresh and so its ids are worthless as handles; a
-- store_product is only ever UPDATEd in place, so its id — and the slug minted
-- beside it — is what a public URL, a cart line and an order line all key on.
--
-- That distinction earns its keep for a reason that will arrive: this instance
-- starts against one Printful store and later moves to the PTO's own. Every
-- printful_sync_product_id and every printfulVariantId inside variants_json
-- changes on that day. Because identity lives in `id`/`slug`/`variants[].id` and
-- the Printful ids are only a MAPPING alongside them, the cutover is an admin
-- re-point (UPDATE printful_sync_product_id, re-sync) rather than a migration,
-- and product URLs, sort order, copy, prices and past orders all survive it.
-- The UNIQUE on printful_sync_product_id is what stops two products being
-- pointed at one Printful design while that re-pointing happens.
--
-- variants_json caches Printful's variant list as
--   [{ id, printfulVariantId, label, imageUrl, inStock, priceCents }]
-- with `id` an opaque ULID WE mint at first import and preserve across every
-- re-sync (matched on printfulVariantId). It is a JSON column rather than a
-- table because nothing is ever filtered, joined or counted by variant — the
-- array is read, rendered or replaced as a unit, exactly like
-- newsletter_issue.events_snapshot_json. Printful's own numeric variant id
-- lives ONLY inside this JSON and never reaches a DTO a browser sees (see
-- publicProductOf in lib/store.ts), so a shopper addresses a size/colour
-- through our id alone — which is also what makes the store cutover above
-- invisible to a cart someone left open.
--
-- Price is PER VARIANT, inside that JSON, not one column on the product.
-- Printful charges more for 2XL/3XL, and a single product price would mean
-- either eating that upcharge or pricing the small sizes at the big ones' rate.
-- There is no CHECK for it here because it lives in JSON; lib/store.ts validates
-- it on every write instead.
CREATE TABLE store_product (
  id                       TEXT PRIMARY KEY,              -- ULID; durable, unlike calendar_event's
  printful_sync_product_id TEXT NOT NULL UNIQUE,          -- mapping, not identity; changes at store cutover
  slug                     TEXT NOT NULL UNIQUE,          -- public URL: /p/:slug
  printful_title           TEXT NOT NULL,                 -- Printful's own name, cached at sync
  title_override           TEXT,                          -- NULL = show printful_title
  blurb                    TEXT,                          -- admin-authored; never translated (invariant 6)
  image_url                TEXT,                          -- primary mockup, for the catalog grid and og:image
  sort_order               INTEGER NOT NULL DEFAULT 0,
  published_at             TEXT,                          -- NULL = imported but not for sale; public routes 404
  variants_json            TEXT NOT NULL DEFAULT '[]',    -- see header; carries the per-variant price
  synced_at                TEXT NOT NULL,                 -- last successful refresh from Printful
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

-- The storefront's only listing query: published rows in display order.
CREATE INDEX idx_store_product_published ON store_product (published_at, sort_order);

-- ── store_order ────────────────────────────────────────────────────────────
--
-- One row per checkout that reached Stripe. It is INSERTed BEFORE payment
-- (status 'awaiting_payment', stripe_session_id still NULL), and that ordering
-- is the point: if the row were created only from checkout.session.completed,
-- then a webhook that never fires AND a buyer who never returns to the success
-- URL would leave money taken and nothing in this database aware an order was
-- ever attempted. Minting first turns that from an invisible loss into a stale
-- 'awaiting_payment' row a sweep can find and reconcile against Stripe.
--
-- `id` is minted here and is what travels to Stripe as metadata.orderId; the
-- webhook claims BY THAT, not by stripe_session_id. The UNIQUE on
-- stripe_session_id is defence in depth (two sessions can never attach to one
-- order), not the idempotency key.
--
-- IDEMPOTENCY. Every forward transition is a guarded UPDATE whose WHERE names
-- the state it is leaving, and `meta.changes` is the authority — the same idiom
-- as the audit chain's CAS on `seq` (migration 0016), the volunteer overfill
-- guard, and claimEditSession (migration 0020). D1 has no read-then-write
-- transaction, so the guard has to live inside the statement. A redelivered
-- Stripe event finds status already 'paid', changes zero rows and is a no-op;
-- a redelivered Printful shipment finds status already 'shipped' and does not
-- send a second "your order shipped" email. No ledger of processed event ids is
-- needed, because there is no read to race.
--
--   awaiting_payment ──▶ paid ──▶ submitting ──▶ submitted ──▶ shipped
--                 │                    │
--                 │                    └──▶ paid            (retry: submission failed)
--                 │                    └──▶ fulfillment_failed  (gave up; needs a human)
--                 └──▶ abandoned                            (sweep: never paid)
--
-- 'abandoned' marks rather than deletes, so "how many checkouts didn't finish"
-- stays answerable and a late webhook still has a row to land on (the guard
-- refuses it, which is the correct answer once Stripe has expired the session).
--
-- cart_json and shipping_address_json are FROZEN at checkout time — the freeze
-- invariant 10 applies to a sent newsletter, for the same reason. A price edited
-- or a product unpublished afterwards must never change what a past order says
-- it cost, and the buyer's address on the order is where it actually shipped,
-- not wherever their profile says they live now. Nothing here references
-- `person` (invariant 26): a shipping name and address are typed at checkout,
-- even by a signed-in member, which is what makes it structurally impossible
-- for a directory member's private contact data to reach Printful or Stripe.
--
-- status_token_hash is the guest order-status page's bearer secret, hashed at
-- rest like every other token in this codebase (migration 0015's
-- preview_token_hash, auth_token's token_hash). Holding it IS the authorization
-- for GET /o/:token — invariant 15's reasoning — so those pages are `no-store`.
-- It is minted once and never rotates or expires: unlike a magic link it grants
-- nothing but a read of one order, and a shopper legitimately wants the link in
-- their confirmation email to still work months later.
CREATE TABLE store_order (
  id                       TEXT PRIMARY KEY,              -- ULID; travels to Stripe as metadata.orderId
  user_id                  TEXT REFERENCES user(id),      -- NULL for a guest checkout
  email                    TEXT NOT NULL,                 -- typed at checkout, or the signed-in account's
  status                   TEXT NOT NULL DEFAULT 'awaiting_payment',
  status_token_hash        TEXT NOT NULL,                 -- sha256 of the /o/:token bearer secret
  stripe_session_id        TEXT UNIQUE,                   -- attached right after the session is created
  stripe_payment_intent_id TEXT,                          -- for reconciliation/refunds in the dashboard
  cart_json                TEXT NOT NULL,                 -- frozen [{productId,variantId,title,variantLabel,imageUrl,unitPriceCents,quantity}]
  shipping_address_json    TEXT NOT NULL,                 -- frozen {name,line1,line2,city,state,postalCode,country,phone}
  shipping_rate_id         TEXT,                          -- Printful's chosen rate id; support/debugging
  shipping_label           TEXT NOT NULL,                 -- e.g. "Standard (3-5 business days)"
  subtotal_cents           INTEGER NOT NULL,
  shipping_cents           INTEGER NOT NULL,
  total_cents              INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'usd',
  printful_order_id        TEXT,                          -- set once submission succeeds
  submit_attempts          INTEGER NOT NULL DEFAULT 0,
  last_submit_error        TEXT,                          -- truncated; what the admin Orders screen shows
  fulfillment_status       TEXT,                          -- Printful's own free-text echo, informational
  tracking_number          TEXT,
  tracking_url             TEXT,
  carrier                  TEXT,
  paid_at                  TEXT,
  submitted_at             TEXT,
  shipped_at               TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  CHECK (status IN ('awaiting_payment','paid','submitting','submitted','shipped','fulfillment_failed','abandoned')),
  CHECK (subtotal_cents >= 0 AND shipping_cents >= 0),
  -- The money invariant, enforced by the database rather than by remembering:
  -- an order's total is its lines plus its shipping, at every write.
  CHECK (total_cents = subtotal_cents + shipping_cents)
);

-- The admin Orders screen (filter by status, newest first) and the re-drive
-- sweep's scan both want this pair, not two single-column indexes — the same
-- composite-index point invariant 19 makes about auth_token (kind, created_at).
CREATE INDEX idx_store_order_status_created ON store_order (status, created_at);

-- The guest order-status page's only lookup.
CREATE UNIQUE INDEX idx_store_order_status_token ON store_order (status_token_hash);

-- Printful's shipment webhook arrives knowing only its own order id.
CREATE INDEX idx_store_order_printful ON store_order (printful_order_id);

-- "My orders" for a signed-in buyer.
CREATE INDEX idx_store_order_user ON store_order (user_id);
