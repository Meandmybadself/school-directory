// Inbound vendor callbacks: Stripe (payment) and Printful (shipment).
//
// These are unauthenticated in the sense that no session cookie arrives — a
// vendor's server is not a browser — but they are NOT "no auth by design" the
// way routes/calendarPublic.ts is. The trust boundary here is a signature, and
// it is a genuinely new mechanism in this codebase, so it lives in its own file
// under its own prefix rather than being filed with the public readers.
//
// THE RAW-BODY RULE. Stripe signs the exact bytes it sent. Both handlers read
// `c.req.raw.text()` and verify BEFORE parsing; re-serialising parsed JSON
// reorders keys and changes whitespace, and the signature then fails in a way
// that looks exactly like a wrong secret. Do not add a JSON-parsing middleware
// in front of this router.
//
// WHY A FORGED CALL IS BOUNDED. Every handler's effect is a guarded UPDATE whose
// WHERE names the state it is leaving. The worst a spoofed Printful shipment can
// do is move one already-submitted order to `shipped` and email that buyer; it
// cannot create an order, move money, or read anything. Stripe's is signed
// properly, so the same reasoning is belt to its braces.

import { Hono, type Context } from "hono";
import type { HonoEnv } from "../env.js";
import {
  markPaid,
  markShipped,
  sendOrderConfirmation,
  sendShippedEmail,
  submitOrder,
} from "../lib/storeOrder.js";
import { verifyWebhook } from "../lib/stripe.js";
import { nowIso } from "../lib/time.js";

export const storeWebhooks = new Hono<HonoEnv>();

/** The two scalars the Slack line is allowed to carry, read off the frozen JSON
 *  the order already holds. Never throws: a malformed blob must not turn a
 *  successful payment into a 500 that Stripe then retries forever. */
function orderSummary(
  cartJson: string,
  addressJson: string,
): { itemCount: number; city: string | null; state: string | null } {
  let itemCount = 0;
  try {
    const lines = JSON.parse(cartJson) as { quantity?: number }[];
    if (Array.isArray(lines)) itemCount = lines.reduce((n, l) => n + (Number(l?.quantity) || 0), 0);
  } catch {
    /* leave it at zero */
  }
  try {
    const a = JSON.parse(addressJson) as { city?: string; state?: string };
    return { itemCount, city: a?.city ?? null, state: a?.state ?? null };
  } catch {
    return { itemCount, city: null, state: null };
  }
}

/** Everything that happens once money has actually moved.
 *
 *  Shared by the two events that can say so — a synchronous
 *  `checkout.session.completed`, and `async_payment_succeeded` for a delayed
 *  method — so the two cannot drift into different definitions of "paid". */
async function handlePaid(
  c: Context<HonoEnv>,
  orderId: string,
  paymentIntentId: string | null,
): Promise<Response> {
  // The guarded UPDATE is the idempotency key. A redelivery of the same event —
  // or the pair of events an async payment method sends — finds the row already
  // `paid`, changes nothing, and returns null here, so nothing below runs twice.
  const row = await markPaid(c.env, orderId, paymentIntentId);
  if (!row) return c.json({ ok: true, duplicate: true });

  // Pushed the moment the write commits, before the sends below — invariant 22's
  // ordering rule. Both of those can fail on their own, and a sale that really
  // happened must not end up with no audit row because an email bounced.
  const summary = orderSummary(row.cart_json, row.shipping_address_json);
  c.var.audit.push({
    action: "store.order.paid",
    entityKind: "store_order",
    entityId: row.id,
    detail: { email: row.email, totalCents: row.total_cents, itemCount: summary.itemCount },
    // Scalars only, and deliberately no name and no street address: the channel
    // is a third party (invariant 22), and "a sale happened, this big, to this
    // town" is the whole of what it needs.
    notify: {
      totalCents: row.total_cents,
      itemCount: summary.itemCount,
      city: summary.city,
      state: summary.state,
    },
  });

  c.executionCtx.waitUntil(submitOrder(c.env, row.id));
  c.executionCtx.waitUntil(sendOrderConfirmation(c.env, row));
  return c.json({ ok: true });
}

/** POST /store-webhooks/stripe */
storeWebhooks.post("/stripe", async (c) => {
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Absent secret means the feature is off, and an unverifiable webhook must
    // never be acted on. 202 rather than an error: Stripe retries a non-2xx for
    // days, and there is nothing here for a retry to fix.
    console.warn("[store] stripe webhook received but STRIPE_WEBHOOK_SECRET is unset");
    return c.json({ ok: true, ignored: true }, 202);
  }

  const raw = await c.req.raw.text();
  const verified = await verifyWebhook(secret, raw, c.req.header("stripe-signature") ?? null);
  if (!verified.ok) {
    console.error(`[store] stripe signature rejected: ${verified.error}`);
    return c.json({ error: "bad_signature" }, 400);
  }

  const event = verified.value;
  const object = event.data?.object ?? {};
  const orderId = object.metadata?.orderId ?? object.client_reference_id ?? null;
  if (!orderId) return c.json({ ok: true, ignored: true });

  switch (event.type) {
    case "checkout.session.completed": {
      // `completed` means the buyer finished the form, NOT that money moved.
      // A delayed method (ACH, bank transfer, voucher) fires this immediately
      // with `payment_status: "unpaid"` and settles days later — so acting on it
      // here would submit an order to Printful, and email a receipt, for a
      // payment that may never arrive. The pair of events such a method sends is
      // handled below: `async_payment_succeeded` is when it is really paid, and
      // `async_payment_failed` is when it isn't.
      const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required";
      if (!paid) return c.json({ ok: true, pending: true });
      return handlePaid(c, orderId, object.payment_intent ?? null);
    }

    case "checkout.session.async_payment_succeeded": {
      // The delayed money actually landed. No `payment_status` check: this event
      // exists precisely to say so.
      return handlePaid(c, orderId, object.payment_intent ?? null);
    }

    case "checkout.session.async_payment_failed": {
      // The debit bounced. The order never left `awaiting_payment` (the branch
      // above declined to advance it), so the same guard that protects the sweep
      // marks it here — and cannot reach back and undo an order that was paid on
      // a second attempt.
      await c.env.DB.prepare(
        `UPDATE store_order SET status = 'abandoned', updated_at = ?
          WHERE id = ? AND status = 'awaiting_payment'`,
      )
        .bind(nowIso(), orderId)
        .run();
      return c.json({ ok: true });
    }

    case "checkout.session.expired": {
      // Stripe knows before our sweep does. Same guard, so this can't reach back
      // and abandon something that was paid on a second attempt.
      await c.env.DB.prepare(
        `UPDATE store_order SET status = 'abandoned', updated_at = ?
          WHERE id = ? AND status = 'awaiting_payment'`,
      )
        .bind(nowIso(), orderId)
        .run();
      return c.json({ ok: true });
    }

    default:
      return c.json({ ok: true, ignored: true });
  }
});

/** POST /store-webhooks/printful?s=<shared secret>
 *
 *  Printful's v1 webhooks carry no signature of Stripe's kind, so the shared
 *  secret in the query string is what authenticates them. That is weaker, and
 *  the design does not lean on it: see this file's header for why the guarded
 *  transition bounds a forged call to one already-submitted order.
 *
 *  Deliberately NOT trusted for money or contents — the only fields read are the
 *  order id and the tracking details, and nothing here can change a total. */
storeWebhooks.post("/printful", async (c) => {
  const expected = c.env.PRINTFUL_WEBHOOK_SECRET;
  if (expected && c.req.query("s") !== expected) {
    return c.json({ error: "forbidden" }, 403);
  }

  const raw = await c.req.raw.text();
  let event: {
    type?: string;
    data?: {
      order?: { id?: number | string; external_id?: string };
      shipment?: {
        carrier?: string;
        service?: string;
        tracking_number?: string;
        tracking_url?: string;
      };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return c.json({ error: "bad_body" }, 400);
  }

  if (event.type !== "package_shipped") return c.json({ ok: true, ignored: true });

  const printfulOrderId = event.data?.order?.id;
  if (printfulOrderId === undefined) return c.json({ ok: true, ignored: true });

  const shipment = event.data?.shipment ?? {};
  const row = await markShipped(c.env, String(printfulOrderId), {
    number: shipment.tracking_number ?? null,
    url: shipment.tracking_url ?? null,
    carrier: [shipment.carrier, shipment.service].filter(Boolean).join(" ") || null,
  });
  // Null means the guard bit: already shipped, or never submitted. Either way
  // there is nothing to do and nobody to email again.
  if (!row) return c.json({ ok: true, duplicate: true });

  c.var.audit.push({
    action: "store.order.shipped",
    entityKind: "store_order",
    entityId: row.id,
    detail: { carrier: row.carrier, tracking: row.tracking_number },
  });
  c.executionCtx.waitUntil(sendShippedEmail(c.env, row));
  return c.json({ ok: true });
});

/** GET /store-webhooks/printful — Printful probes an endpoint before saving it.
 *  Answer 200 and do nothing; there is no state a GET may touch (invariant 19's
 *  rule, for the same reason: a scanner following this link must change
 *  nothing). */
storeWebhooks.get("/printful", (c) => c.json({ ok: true }));
