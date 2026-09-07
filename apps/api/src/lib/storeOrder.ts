// The order lifecycle: checkout, payment, fulfilment, shipment, recovery.
//
// Every forward transition is a guarded UPDATE whose WHERE names the state it is
// leaving, and `res.meta.changes` is the authority — the idiom the audit chain's
// CAS on `seq`, the volunteer overfill guard and `claimEditSession` all use,
// because D1 has no read-then-write transaction. That single choice is also the
// whole idempotency story: a redelivered Stripe event finds the row already
// `paid` and changes nothing; a redelivered Printful shipment finds it already
// `shipped` and mails nobody twice. There is no ledger of processed event ids
// because there is no read to race.
//
//   awaiting_payment ──▶ paid ──▶ submitting ──▶ submitted ──▶ shipped
//                 │                    │
//                 │                    ├──▶ paid                 (retry)
//                 │                    └──▶ fulfillment_failed   (needs a human)
//                 └──▶ abandoned                                 (never paid)

import type {
  PublicStoreOrderDTO,
  PublicStoreOrderStatus,
  StoreAddressInput,
  StoreLineDTO,
  StoreOrderDTO,
  StoreOrderStatus,
} from "@sd/shared";
import { formatMoney as money } from "@sd/shared";
import type { AuthContext, Env } from "../env.js";
import type { AuditDraft, AuditMeta } from "./audit.js";
import { writeAudit } from "./audit.js";
import { sha256 } from "./crypto.js";
import { sendEmail } from "./email.js";
import { ulid } from "./ids.js";
import { createOrder } from "./printful.js";
import { notifySlackForAudit } from "./slackNotify.js";
import { assertLinesStillSellable, printfulIdsForLines, StoreError } from "./store.js";
import type { QuotePayload } from "./storeQuote.js";
import { storeSecret } from "./storeQuote.js";
import { createCheckoutSession } from "./stripe.js";
import { MINUTES, nowIso } from "./time.js";

/** How many times we ask Printful before calling it a failure that needs a
 *  person. Sized like the audit chain's retry budget: generous, because giving
 *  up early on a PAID order is the expensive mistake, not retrying. */
const MAX_SUBMIT_ATTEMPTS = 6;

/** A `submitting` row untouched for this long is presumed to belong to a Worker
 *  that died mid-call, and may be re-claimed. Comfortably longer than
 *  printful.ts's 15s request timeout. */
const SUBMIT_STALE_MS = 10 * MINUTES;

/** Stripe expires an unpaid Checkout Session after 24 hours; after that an
 *  `awaiting_payment` row can never legitimately advance. */
const ABANDON_AFTER_MS = 26 * 60 * MINUTES;

/** Nobody is signed in when a webhook or a cron writes. Same shape the
 *  anonymous audit rows already use (`auth.registered`, `newsletter.subscribed`). */
const SYSTEM_META: AuditMeta = {
  actorUserId: null,
  masqueradingAs: null,
  ip: null,
  userAgent: null,
};

// ── Rows ────────────────────────────────────────────────────────────────────

export interface StoreOrderRow {
  id: string;
  user_id: string | null;
  email: string;
  status: StoreOrderStatus;
  status_token_hash: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  cart_json: string;
  shipping_address_json: string;
  shipping_rate_id: string | null;
  shipping_label: string;
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  printful_order_id: string | null;
  submit_attempts: number;
  last_submit_error: string | null;
  fulfillment_status: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  carrier: string | null;
  paid_at: string | null;
  submitted_at: string | null;
  shipped_at: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT_ORDER = `SELECT id, user_id, email, status, status_token_hash, stripe_session_id,
         stripe_payment_intent_id, cart_json, shipping_address_json, shipping_rate_id,
         shipping_label, subtotal_cents, shipping_cents, total_cents, currency,
         printful_order_id, submit_attempts, last_submit_error, fulfillment_status,
         tracking_number, tracking_url, carrier, paid_at, submitted_at, shipped_at,
         created_at, updated_at
    FROM store_order`;

function lines(row: StoreOrderRow): StoreLineDTO[] {
  try {
    const parsed = JSON.parse(row.cart_json) as unknown;
    return Array.isArray(parsed) ? (parsed as StoreLineDTO[]) : [];
  } catch {
    console.error(`[store] order ${row.id} has unparseable cart_json`);
    return [];
  }
}

function address(row: StoreOrderRow): StoreAddressInput {
  try {
    return JSON.parse(row.shipping_address_json) as StoreAddressInput;
  } catch {
    console.error(`[store] order ${row.id} has unparseable shipping_address_json`);
    return { name: "", line1: "", city: "", state: "", postalCode: "", country: "US" };
  }
}

export async function orderById(env: Env, id: string): Promise<StoreOrderRow | null> {
  return env.DB.prepare(`${SELECT_ORDER} WHERE id = ?`).bind(id).first<StoreOrderRow>();
}

/** Orders placed while signed in. A guest checkout has no `user_id` and never
 *  appears here — matching one to an account by email afterwards would let
 *  anyone who signs up with an address see what it once bought. */
export async function ordersForUser(env: Env, userId: string): Promise<StoreOrderRow[]> {
  const res = await env.DB.prepare(
    `${SELECT_ORDER} WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(userId)
    .all<StoreOrderRow>();
  return res.results;
}

/** The admin list. Unfiltered it EXCLUDES `abandoned`: an unpaid checkout is
 *  kept (migration 0022) but it is not an order, and burying six real ones under
 *  forty abandoned carts is how a stuck order goes unnoticed. */
export async function listOrders(env: Env, status?: string): Promise<StoreOrderRow[]> {
  const res = status
    ? await env.DB.prepare(`${SELECT_ORDER} WHERE status = ? ORDER BY created_at DESC LIMIT 200`)
        .bind(status)
        .all<StoreOrderRow>()
    : await env.DB.prepare(
        `${SELECT_ORDER} WHERE status <> 'abandoned' ORDER BY created_at DESC LIMIT 200`,
      ).all<StoreOrderRow>();
  return res.results;
}

// ── The order-status token ──────────────────────────────────────────────────

/** Domain prefix — see storeQuote.ts's note on why every message under
 *  STORE_SECRET says what it is. */
const STATUS_DOMAIN = "store-order-status.v1:";

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The bearer secret for `/o/:token`, DERIVED from the order id rather than
 * randomly generated.
 *
 * A random token would have to be either stored in the clear — a live capability
 * sitting in the database, which is the thing migration 0015 hashes precisely to
 * avoid — or hashed and then unavailable when the confirmation email is built,
 * because that happens in the Stripe webhook, long after the raw value was
 * handed to the browser. Deriving it solves both: nothing but the hash is
 * stored, and any later request can recompute the link.
 *
 * The trade, stated so nobody discovers it: rotating STORE_SECRET invalidates
 * every order-status link ever emailed. That is acceptable for a link that only
 * reads one order, and it is the reason this secret is separate from anything
 * on the auth path.
 */
export async function orderStatusToken(env: Env, orderId: string): Promise<string | null> {
  const secret = storeSecret(env);
  if (!secret.ok) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret.value),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(STATUS_DOMAIN + orderId));
  return hex(mac);
}

/** Look an order up by the token in its URL. The lookup is on the HASH, so the
 *  stored value is not itself usable as a link — invariant 15's rule. */
export async function orderByStatusToken(env: Env, token: string): Promise<StoreOrderRow | null> {
  if (!token) return null;
  return env.DB.prepare(`${SELECT_ORDER} WHERE status_token_hash = ?`)
    .bind(await sha256(token))
    .first<StoreOrderRow>();
}

export async function orderStatusUrl(env: Env, orderId: string): Promise<string | null> {
  const token = await orderStatusToken(env, orderId);
  if (!token) return null;
  return `${env.STORE_URL}/o/${token}`;
}

// ── Projections ─────────────────────────────────────────────────────────────

/** Internal states collapse to three, because the distinctions we care about
 *  operationally are not distinctions a buyer can act on. "Submitting" and
 *  "submitted" are both waiting; "fulfillment_failed" must not read as "your
 *  money is gone" when the truth is that a person is about to look at it. */
function publicStatus(status: StoreOrderStatus): PublicStoreOrderStatus {
  switch (status) {
    case "shipped":
      return "shipped";
    case "fulfillment_failed":
    case "abandoned":
      return "problem";
    default:
      return "processing";
  }
}

/**
 * The token-gated order page, built field by field.
 *
 * Never spreads the row, for the reason `issuePageOf` never does: `store_order`
 * holds `status_token_hash`, and the Stripe and Printful ids besides. A spread
 * would publish operational internals — and a hashed capability — on a page
 * whose whole security model is that only the URL holder reaches it.
 */
export function orderStatusOf(row: StoreOrderRow): PublicStoreOrderDTO {
  const shipTo = address(row);
  return {
    status: publicStatus(row.status),
    lines: lines(row),
    subtotalCents: row.subtotal_cents,
    shippingLabel: row.shipping_label,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    // Enough to recognise the parcel, not the full street address: this page is
    // reachable by anyone holding a forwarded link, and the line1 adds nothing
    // the buyer doesn't already know.
    shipTo: {
      name: shipTo.name,
      city: shipTo.city,
      state: shipTo.state,
      postalCode: shipTo.postalCode,
    },
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    carrier: row.carrier,
    placedAt: row.paid_at,
    shippedAt: row.shipped_at,
  };
}

/** The admin view. Also hand-written — the row carries the status-token hash,
 *  and an admin screen has no business holding one. */
export function orderDto(row: StoreOrderRow): StoreOrderDTO {
  return {
    id: row.id,
    status: row.status,
    userId: row.user_id,
    email: row.email,
    lines: lines(row),
    shippingAddress: address(row),
    subtotalCents: row.subtotal_cents,
    shippingLabel: row.shipping_label,
    shippingCents: row.shipping_cents,
    totalCents: row.total_cents,
    currency: row.currency,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    printfulOrderId: row.printful_order_id,
    submitAttempts: row.submit_attempts,
    lastSubmitError: row.last_submit_error,
    fulfillmentStatus: row.fulfillment_status,
    trackingNumber: row.tracking_number,
    trackingUrl: row.tracking_url,
    carrier: row.carrier,
    paidAt: row.paid_at,
    submittedAt: row.submitted_at,
    shippedAt: row.shipped_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Checkout ────────────────────────────────────────────────────────────────

/**
 * Mint the order, then the Stripe session.
 *
 * That order matters and is the one place this design deliberately spends a row
 * on something that may never be paid for. If the row were created from the
 * webhook instead, a webhook that never fires AND a buyer who never returns
 * would leave money taken and nothing here aware of it. Minting first turns an
 * invisible loss into a stale `awaiting_payment` row the sweep can find.
 *
 * The quote's prices are used as-is. They were computed server-side from
 * `store_product` when the quote was signed, and re-deriving them here would
 * reopen exactly the gap freezing them closed — a buyer must pay what they were
 * shown. Availability IS re-checked, because selling something an admin
 * unpublished five minutes ago fails at Printful after the card is charged.
 */
export async function startCheckout(
  env: Env,
  quote: QuotePayload,
  auth: AuthContext | null,
): Promise<{ orderId: string; checkoutUrl: string }> {
  await assertLinesStillSellable(env, quote.lines);

  const orderId = ulid();
  const token = await orderStatusToken(env, orderId);
  if (!token) throw new StoreError("The store is not fully configured. Please try again later.");
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO store_order
       (id, user_id, email, status, status_token_hash, cart_json, shipping_address_json,
        shipping_rate_id, shipping_label, subtotal_cents, shipping_cents, total_cents,
        currency, created_at, updated_at)
     VALUES (?,?,?,'awaiting_payment',?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      orderId,
      auth?.userId ?? null,
      quote.email,
      await sha256(token),
      JSON.stringify(quote.lines),
      JSON.stringify(quote.address),
      quote.shippingRateId,
      quote.shippingLabel,
      quote.subtotalCents,
      quote.shippingCents,
      quote.totalCents,
      quote.currency,
      now,
      now,
    )
    .run();

  const session = await createCheckoutSession(env, {
    orderId,
    email: quote.email,
    lines: quote.lines.map((l) => ({
      name: `${l.title} — ${l.variantLabel}`,
      imageUrl: l.imageUrl,
      unitPriceCents: l.unitPriceCents,
      quantity: l.quantity,
    })),
    shippingLabel: quote.shippingLabel,
    shippingCents: quote.shippingCents,
    currency: quote.currency,
    shipTo: {
      name: quote.address.name,
      line1: quote.address.line1,
      line2: quote.address.line2 ?? null,
      city: quote.address.city,
      state: quote.address.state,
      postalCode: quote.address.postalCode,
      country: quote.address.country,
    },
    successUrl: `${env.STORE_URL}/o/${token}`,
    cancelUrl: `${env.STORE_URL}/cart`,
  });

  if (!session.ok) {
    // The row stays `awaiting_payment` and the sweep will abandon it. Leaving it
    // is better than deleting: "a checkout was attempted and Stripe refused" is
    // a fact worth being able to see.
    throw new StoreError("We couldn't start checkout. Please try again in a moment.");
  }

  await env.DB.prepare("UPDATE store_order SET stripe_session_id = ?, updated_at = ? WHERE id = ?")
    .bind(session.value.id, nowIso(), orderId)
    .run();

  return { orderId, checkoutUrl: session.value.url };
}

// ── Payment ─────────────────────────────────────────────────────────────────

/**
 * Claim an order as paid. Returns the row when THIS call made the transition,
 * and null when it did not — which is what a redelivered Stripe event gets.
 *
 * The caller must push `store.order.paid` only on a non-null return, or a
 * webhook retried four times would report four sales.
 */
export async function markPaid(
  env: Env,
  orderId: string,
  paymentIntentId: string | null,
): Promise<StoreOrderRow | null> {
  const now = nowIso();
  const res = await env.DB.prepare(
    `UPDATE store_order
        SET status = 'paid', paid_at = ?, stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
            updated_at = ?
      WHERE id = ? AND status = 'awaiting_payment'`,
  )
    .bind(now, paymentIntentId, now, orderId)
    .run();
  if (!res.meta || res.meta.changes === 0) return null;
  return orderById(env, orderId);
}

// ── Fulfilment ──────────────────────────────────────────────────────────────

/**
 * Send a paid order to Printful, at most once.
 *
 * The claim is a guarded UPDATE that only one caller can win, so the inline
 * `waitUntil` fired by the webhook and the cron re-drive can never both submit
 * the same order — the failure that would print two shirts and bill the PTO for
 * both. A `submitting` row left stale by a dead Worker becomes re-claimable
 * after SUBMIT_STALE_MS, which is what stops one crash stranding an order
 * forever.
 *
 * Never throws: it runs detached from any request, where a rejection would be an
 * unobserved promise.
 */
export async function submitOrder(env: Env, orderId: string): Promise<void> {
  const now = nowIso();
  const staleBefore = new Date(Date.now() - SUBMIT_STALE_MS).toISOString();

  const claim = await env.DB.prepare(
    `UPDATE store_order
        SET status = 'submitting', submit_attempts = submit_attempts + 1, updated_at = ?
      WHERE id = ?
        AND (status = 'paid' OR (status = 'submitting' AND updated_at < ?))`,
  )
    .bind(now, orderId, staleBefore)
    .run();
  if (!claim.meta || claim.meta.changes === 0) return; // someone else holds it

  const row = await orderById(env, orderId);
  if (!row) return;

  // The budget is checked HERE as well as in recordSubmitFailure, and it is not
  // belt-and-braces — it closes a real hole. recordSubmitFailure only runs when
  // the Printful call THREW. A Worker evicted mid-call never reaches it, so the
  // row is left `submitting`, reclaimed ten minutes later, and tried again — a
  // loop that increments `submit_attempts` forever without ever reaching
  // `fulfillment_failed` or telling anybody. Without this the worst failure mode
  // is the quietest one: a charged order retrying into the void.
  if (row.submit_attempts > MAX_SUBMIT_ATTEMPTS) {
    await recordSubmitFailure(env, orderId, new Error("gave up after repeated interrupted attempts"));
    return;
  }

  try {
    const ship = address(row);
    const items = await printfulIdsForLines(env, lines(row));
    const result = await createOrder(env, {
      externalId: row.id,
      // Exactly the rate that was quoted and charged, never re-derived: a
      // cheaper method chosen here would be a different parcel than the one the
      // buyer paid for.
      shippingRateId: row.shipping_rate_id ?? "STANDARD",
      recipient: {
        name: ship.name,
        address1: ship.line1,
        address2: ship.line2 ?? null,
        city: ship.city,
        stateCode: ship.state,
        countryCode: ship.country,
        zip: ship.postalCode,
        email: row.email,
        phone: ship.phone ?? null,
      },
      items,
    });
    if (!result.ok) throw new Error(result.error);

    await env.DB.prepare(
      `UPDATE store_order
          SET status = 'submitted', printful_order_id = ?, submitted_at = ?,
              last_submit_error = NULL, updated_at = ?
        WHERE id = ? AND status = 'submitting'`,
    )
      .bind(result.value.printfulOrderId, nowIso(), nowIso(), orderId)
      .run();
  } catch (err) {
    await recordSubmitFailure(env, orderId, err);
  }
}

async function recordSubmitFailure(env: Env, orderId: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  const row = await orderById(env, orderId);
  const attempts = row?.submit_attempts ?? MAX_SUBMIT_ATTEMPTS;
  const givingUp = attempts >= MAX_SUBMIT_ATTEMPTS;
  const now = nowIso();

  await env.DB.prepare(
    `UPDATE store_order SET status = ?, last_submit_error = ?, updated_at = ?
      WHERE id = ? AND status = 'submitting'`,
  )
    .bind(givingUp ? "fulfillment_failed" : "paid", message, now, orderId)
    .run();

  console.error(`[store] submit failed for ${orderId} (attempt ${attempts}): ${message}`);
  if (!givingUp) return;

  // Charged and not printed, with the retries spent. The one store event that
  // needs a human, so it is written to the log and posted to Slack directly —
  // there is no request whose `c.var.audit` this could ride on.
  const draft: AuditDraft = {
    action: "store.order.fulfillment_failed",
    entityKind: "store_order",
    entityId: orderId,
    detail: { error: message, attempts },
    notify: { totalCents: row?.total_cents ?? 0, attempts },
  };
  await writeAudit(env, draft, SYSTEM_META).catch((e) =>
    console.error("[store] failed to write fulfillment_failed audit", e),
  );
  await notifySlackForAudit(env, [draft], SYSTEM_META);
}

/**
 * The backstop. Picks up anything the inline submit never got to (the Worker
 * was recycled before `waitUntil` ran), anything that failed transiently, and
 * anything stranded mid-claim.
 *
 * "Paid but not submitted" is therefore not a state to design around — it is
 * simply `status = 'paid'`, and this query is what makes it self-healing.
 */
export async function retryStuckOrders(env: Env): Promise<void> {
  const staleBefore = new Date(Date.now() - SUBMIT_STALE_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT id FROM store_order
      WHERE status = 'paid' OR (status = 'submitting' AND updated_at < ?)
      ORDER BY created_at ASC
      LIMIT 25`,
  )
    .bind(staleBefore)
    .all<{ id: string }>();

  for (const row of rows.results) {
    try {
      await submitOrder(env, row.id);
    } catch (err) {
      console.error(`[store] retry failed for ${row.id}: ${String(err)}`);
    }
  }
}

// ── Shipment ────────────────────────────────────────────────────────────────

/** Record a shipment, at most once. Returns the row when this call made the
 *  transition — a redelivered Printful webhook gets null and mails nobody. */
export async function markShipped(
  env: Env,
  printfulOrderId: string,
  tracking: { number: string | null; url: string | null; carrier: string | null },
): Promise<StoreOrderRow | null> {
  const now = nowIso();
  const res = await env.DB.prepare(
    `UPDATE store_order
        SET status = 'shipped', tracking_number = ?, tracking_url = ?, carrier = ?,
            fulfillment_status = 'fulfilled', shipped_at = ?, updated_at = ?
      WHERE printful_order_id = ? AND status = 'submitted'`,
  )
    .bind(tracking.number, tracking.url, tracking.carrier, now, now, printfulOrderId)
    .run();
  if (!res.meta || res.meta.changes === 0) return null;
  return env.DB.prepare(`${SELECT_ORDER} WHERE printful_order_id = ?`)
    .bind(printfulOrderId)
    .first<StoreOrderRow>();
}

// ── Sweep ───────────────────────────────────────────────────────────────────

/** Mark, don't delete: "how many checkouts didn't finish" stays answerable, and
 *  a late webhook still finds a row — whose guard correctly refuses it, since
 *  Stripe has expired the session by then. */
export async function sweepAbandonedOrders(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS).toISOString();
  try {
    const res = await env.DB.prepare(
      `UPDATE store_order SET status = 'abandoned', updated_at = ?
        WHERE status = 'awaiting_payment' AND created_at < ?`,
    )
      .bind(nowIso(), cutoff)
      .run();
    const n = res.meta?.changes ?? 0;
    if (n > 0) console.log(`[sweep] abandoned ${n} unpaid store orders`);
  } catch (err) {
    console.error(`[sweep] store orders failed: ${String(err)}`);
  }
}

// ── Email ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function receiptLines(row: StoreOrderRow): { html: string; text: string } {
  const items = lines(row);
  const html = items
    .map(
      (l) =>
        `<tr><td style="padding:4px 12px 4px 0">${esc(l.title)} — ${esc(l.variantLabel)} × ${l.quantity}</td>` +
        `<td style="padding:4px 0;text-align:right">${money(l.unitPriceCents * l.quantity, row.currency)}</td></tr>`,
    )
    .join("");
  const text = items
    .map((l) => `  ${l.title} — ${l.variantLabel} × ${l.quantity}  ${money(l.unitPriceCents * l.quantity, row.currency)}`)
    .join("\n");
  return { html, text };
}

/** Sent once, from the Stripe webhook, only when the guarded UPDATE actually
 *  claimed the row — so a redelivered event does not re-send it. */
export async function sendOrderConfirmation(env: Env, row: StoreOrderRow): Promise<void> {
  const url = await orderStatusUrl(env, row.id);
  const { html, text } = receiptLines(row);
  const total = money(row.total_cents, row.currency);
  const school = env.SCHOOL_NAME;

  await sendEmail(env, {
    to: row.email,
    subject: `Your ${school} store order`,
    html:
      `<p>Thanks — we've got your order.</p>` +
      `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">${html}` +
      `<tr><td style="padding:4px 12px 4px 0">${esc(row.shipping_label)}</td>` +
      `<td style="padding:4px 0;text-align:right">${money(row.shipping_cents, row.currency)}</td></tr>` +
      `<tr><td style="padding:8px 12px 0 0;font-weight:600">Total</td>` +
      `<td style="padding:8px 0 0;text-align:right;font-weight:600">${total}</td></tr></table>` +
      (url ? `<p><a href="${esc(url)}">Check your order status</a></p>` : "") +
      `<p style="color:#555">It's printed to order, so give it a few days before it ships.</p>`,
    text:
      `Thanks — we've got your order.\n\n${text}\n  ${row.shipping_label}  ${money(row.shipping_cents, row.currency)}\n  Total  ${total}\n\n` +
      (url ? `Check your order status: ${url}\n\n` : "") +
      `It's printed to order, so give it a few days before it ships.\n`,
  });
}

/** Sent once, from the Printful webhook, on the same guarded-transition rule. */
export async function sendShippedEmail(env: Env, row: StoreOrderRow): Promise<void> {
  const url = await orderStatusUrl(env, row.id);
  const tracking = row.tracking_url
    ? `<p><a href="${esc(row.tracking_url)}">Track your parcel</a>${row.carrier ? ` (${esc(row.carrier)})` : ""}</p>`
    : row.tracking_number
      ? `<p>Tracking: ${esc(row.tracking_number)}${row.carrier ? ` (${esc(row.carrier)})` : ""}</p>`
      : "";
  await sendEmail(env, {
    to: row.email,
    subject: `Your ${env.SCHOOL_NAME} store order has shipped`,
    html: `<p>Your order is on its way.</p>${tracking}` + (url ? `<p><a href="${esc(url)}">Order details</a></p>` : ""),
    text:
      `Your order is on its way.\n` +
      (row.tracking_number ? `Tracking: ${row.tracking_number}${row.carrier ? ` (${row.carrier})` : ""}\n` : "") +
      (row.tracking_url ? `${row.tracking_url}\n` : "") +
      (url ? `\nOrder details: ${url}\n` : ""),
  });
}
