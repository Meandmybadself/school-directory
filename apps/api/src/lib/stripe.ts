// Stripe, over plain `fetch` and Web Crypto — no SDK.
//
// This API has two runtime dependencies (hono, ical.js) and hand-rolls an HTML
// sanitizer and an ICS writer rather than adding more. The two things the store
// needs from Stripe are a form-encoded POST and an HMAC-SHA256 check, so the
// same judgement applies here. The trade is stated plainly because it is the one
// place in this feature where a subtle bug costs money: `verifyWebhook` below is
// the function to read twice, and test/storeCheckout.test.ts feeds it known-good,
// tampered, replayed and malformed signatures.
//
// Same absent-secret contract as lib/email.ts and lib/printful.ts: with no
// STRIPE_SECRET_KEY the session isn't created and the call is logged, so the
// whole cart flow is walkable in local dev right up to the redirect.

import type { Env } from "../env.js";

const STRIPE_BASE = "https://api.stripe.com/v1";
const TIMEOUT_MS = 15_000;

/** Stripe's documented replay window for webhook signatures. A `t` older than
 *  this is refused even when the HMAC matches, so a captured request can't be
 *  replayed later. */
const SIGNATURE_TOLERANCE_S = 300;

export type StripeResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CheckoutLine {
  name: string;
  /** Absolute URL; Stripe fetches it for the Checkout page. Optional. */
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
}

export interface CheckoutSessionRequest {
  /** Our store_order ULID. Travels as metadata and is what the webhook claims
   *  the order by — see migration 0022's header on why not the session id. */
  orderId: string;
  email: string;
  lines: CheckoutLine[];
  /** The ONE shipping option, already priced by Printful and frozen in the
   *  quote. Hosted Checkout cannot compute shipping from an address, which is
   *  the whole reason the cart collects the address first. */
  shippingLabel: string;
  shippingCents: number;
  currency: string;
  /** Attached to the PaymentIntent, not to metadata: Stripe uses a real
   *  `shipping` field for dispute evidence and fraud signals, and we are not
   *  collecting the address on their page. It is the address the buyer typed at
   *  checkout — never read from a Person (invariant 26). */
  shipTo: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  successUrl: string;
  cancelUrl: string;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

/** Stripe takes `application/x-www-form-urlencoded` with bracketed paths for
 *  nested values (`line_items[0][price_data][unit_amount]`). This flattens a
 *  plain object into that shape; null/undefined entries are dropped so callers
 *  can build the object with optional fields inline. */
function formEncode(value: unknown, prefix = "", out = new URLSearchParams()): URLSearchParams {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return out;
  }
  out.set(prefix, String(value));
  return out;
}

async function post<T>(env: Env, path: string, body: unknown): Promise<StripeResult<T>> {
  if (!env.STRIPE_SECRET_KEY) {
    console.log(`[stripe:dev] POST ${path} ${formEncode(body).toString()}`);
    return { ok: false, error: "stripe_not_configured" };
  }
  try {
    const res = await fetch(`${STRIPE_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // Stripe pins request/response shapes to the key's configured version;
        // naming it here means an account-level version bump can't silently
        // change what this code parses.
        "Stripe-Version": "2024-06-20",
      },
      body: formEncode(body).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      let reason = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) reason = parsed.error.message;
      } catch {
        /* keep the raw body */
      }
      console.error(`[stripe] ${res.status} ${path}: ${reason}`);
      return { ok: false, error: `${res.status}: ${reason}`.slice(0, 300) };
    }
    return { ok: true, value: JSON.parse(text) as T };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[stripe] ${path} failed: ${error}`);
    return { ok: false, error: error.slice(0, 300) };
  }
}

/** Create a hosted Checkout Session for one already-priced order.
 *
 *  Address collection is deliberately OFF: the cart already took the address in
 *  order to quote real Printful shipping, and letting the buyer change it on
 *  Stripe's page would silently invalidate the rate we bought. */
export async function createCheckoutSession(
  env: Env,
  input: CheckoutSessionRequest,
): Promise<StripeResult<StripeCheckoutSession>> {
  const body = {
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email,
    client_reference_id: input.orderId,
    metadata: { orderId: input.orderId },
    payment_intent_data: {
      // Repeated on the PaymentIntent so a refund or dispute opened months later
      // in the Stripe dashboard can be tied back without our database.
      metadata: { orderId: input.orderId },
      shipping: {
        name: input.shipTo.name,
        address: {
          line1: input.shipTo.line1,
          line2: input.shipTo.line2,
          city: input.shipTo.city,
          state: input.shipTo.state,
          postal_code: input.shipTo.postalCode,
          country: input.shipTo.country,
        },
      },
    },
    line_items: input.lines.map((l) => ({
      quantity: l.quantity,
      price_data: {
        currency: input.currency,
        unit_amount: l.unitPriceCents,
        product_data: {
          name: l.name,
          ...(l.imageUrl ? { images: [l.imageUrl] } : {}),
        },
      },
    })),
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: input.shippingLabel,
          fixed_amount: { amount: input.shippingCents, currency: input.currency },
        },
      },
    ],
  };

  const res = await post<{ id?: string; url?: string }>(env, "/checkout_sessions", body);
  if (!res.ok) return res;
  if (!res.value.id || !res.value.url) return { ok: false, error: "stripe returned no session url" };
  return { ok: true, value: { id: res.value.id, url: res.value.url } };
}

/** The slice of a Stripe event this store acts on. */
export interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id?: string;
      payment_intent?: string;
      metadata?: Record<string, string>;
      client_reference_id?: string;
      /**
       * "paid" | "unpaid" | "no_payment_required".
       *
       * The field that makes `checkout.session.completed` mean something
       * narrower than its name suggests: for a DELAYED payment method — ACH
       * debit, a bank transfer, a voucher — Stripe fires `completed` the moment
       * the buyer finishes the form, with `payment_status: "unpaid"`, and the
       * money arrives days later (or never). Fulfilling on `completed` alone
       * therefore prints and ships an order that has not been paid for.
       *
       * `createCheckoutSession` does not restrict `payment_method_types`, so
       * whatever is enabled in the Stripe dashboard applies — which is exactly
       * the configuration where this bites, and why the field is read rather
       * than the methods narrowed.
       */
      payment_status?: string;
    };
  };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verify a `Stripe-Signature` header against the RAW request body.
 *
 * The scheme, from Stripe's docs: the header is a comma-separated list of
 * `key=value` pairs carrying one `t=<unix seconds>` and one or more
 * `v1=<hex hmac>`; the signed payload is the literal string
 * `${t}.${rawBody}`; the MAC is HMAC-SHA256 under the endpoint secret. More
 * than one `v1` appears while a secret is being rotated, so ANY match is a
 * pass.
 *
 * Two rules this depends on, both easy to break later:
 *
 *   The body must be the exact bytes Stripe sent. The route reads
 *   `c.req.raw.text()` and verifies BEFORE parsing — re-serialising parsed JSON
 *   reorders keys and changes whitespace, and the signature fails for reasons
 *   that look like a wrong secret.
 *
 *   The timestamp is checked as well as the MAC. Without it a captured request
 *   replays forever, since the signature over an unchanged body stays valid.
 *
 * Comparison goes through `crypto.subtle.verify` rather than string equality:
 * it is constant-time, so a wrong signature leaks nothing about how much of it
 * was right.
 */
export async function verifyWebhook(
  secret: string,
  rawBody: string,
  signatureHeader: string | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<StripeResult<StripeEvent>> {
  if (!signatureHeader) return { ok: false, error: "missing signature header" };

  let timestamp: number | null = null;
  const candidates: Uint8Array[] = [];
  for (const part of signatureHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (key === "v1") {
      const bytes = hexToBytes(value);
      if (bytes) candidates.push(bytes);
    }
  }
  if (timestamp === null) return { ok: false, error: "signature header has no timestamp" };
  if (candidates.length === 0) return { ok: false, error: "signature header has no v1 signature" };
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_S) {
    return { ok: false, error: "signature timestamp outside tolerance" };
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = enc.encode(`${timestamp}.${rawBody}`);

  let matched = false;
  for (const candidate of candidates) {
    // A fresh BufferSource per call; `verify` is constant-time internally.
    if (await crypto.subtle.verify("HMAC", key, candidate as BufferSource, signed)) {
      matched = true;
      break;
    }
  }
  if (!matched) return { ok: false, error: "no signature matched" };

  try {
    return { ok: true, value: JSON.parse(rawBody) as StripeEvent };
  } catch {
    return { ok: false, error: "signed body was not json" };
  }
}
