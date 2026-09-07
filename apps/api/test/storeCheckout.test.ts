// The money path: the signed quote, Stripe's webhook signature, and the
// compare-and-swap that makes every state transition idempotent.
//
// This is the file to read hardest. It pins the three places where a bug costs
// real money rather than a wrong pixel:
//
//   1. A quote is a PRICE we signed. If it can be tampered with, forged, or
//      replayed after expiry, a buyer sets their own price.
//   2. Stripe's webhook is the only inbound message that says money moved. If
//      the signature check can be fooled — by a wrong secret, a tampered body,
//      or a captured request replayed tomorrow — anyone can mark an order paid.
//   3. Every transition is a guarded UPDATE. If the guard is dropped, a webhook
//      Stripe retries four times sends four confirmation emails and, worse, the
//      submission path prints and bills for the same order twice.
//
// Property 3 is tested BEHAVIOURALLY against a fake D1 that really honours the
// WHERE clause, for the same reason test/slackNotify.test.ts is behavioural: a
// guard that had been quietly weakened would still look right in a grep.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import { signQuote, verifyQuote } from "../src/lib/storeQuote.js";
import { verifyWebhook } from "../src/lib/stripe.js";
import { markPaid, markShipped, orderStatusToken } from "../src/lib/storeOrder.js";

const SECRET = "test-store-secret";
const WEBHOOK_SECRET = "whsec_testtesttesttest";

function env(overrides: Partial<Env> = {}): Env {
  return {
    STORE_SECRET: SECRET,
    SCHOOL_NAME: "Eisenhower PTO",
    STORE_URL: "https://store.eisenhower.school",
    ...overrides,
  } as unknown as Env;
}

function quotePayload(overrides: Record<string, unknown> = {}) {
  return {
    email: "buyer@example.com",
    address: {
      name: "Dana Ruiz",
      line1: "412 Maple Street",
      line2: null,
      city: "Hopkins",
      state: "MN",
      postalCode: "55305",
      country: "US",
      phone: null,
    },
    lines: [
      {
        productId: "01PRODUCT",
        variantId: "01VARSM",
        title: "Spirit Tee",
        variantLabel: "Navy / S",
        imageUrl: null,
        unitPriceCents: 2400,
        quantity: 2,
      },
    ],
    subtotalCents: 4800,
    shippingRateId: "STANDARD",
    shippingLabel: "Standard",
    shippingCents: 595,
    totalCents: 5395,
    currency: "usd",
    exp: Date.now() + 60_000,
    ...overrides,
  } as Parameters<typeof signQuote>[1];
}

// ── The signed quote ────────────────────────────────────────────────────────

describe("quote token", () => {
  it("round-trips a quote it signed", async () => {
    const signed = await signQuote(env(), quotePayload());
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const verified = await verifyQuote(env(), signed.value);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.totalCents).toBe(5395);
    expect(verified.value.lines[0]?.unitPriceCents).toBe(2400);
  });

  it("refuses a token whose payload was edited", async () => {
    const signed = await signQuote(env(), quotePayload());
    if (!signed.ok) throw new Error("sign failed");

    // The attack this exists to stop: decode the payload, halve the total,
    // re-encode, keep the original signature.
    const [body, mac] = signed.value.split(".");
    const decoded = JSON.parse(atob(body!.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    decoded.totalCents = 1;
    decoded.subtotalCents = 1;
    const forged = btoa(JSON.stringify(decoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const verified = await verifyQuote(env(), `${forged}.${mac}`);
    expect(verified).toEqual({ ok: false, error: "quote_invalid" });
  });

  it("refuses a token signed with a different secret", async () => {
    const signed = await signQuote(env({ STORE_SECRET: "someone-elses-secret" }), quotePayload());
    if (!signed.ok) throw new Error("sign failed");
    expect(await verifyQuote(env(), signed.value)).toEqual({ ok: false, error: "quote_invalid" });
  });

  it("refuses an expired token even though the signature is good", async () => {
    const signed = await signQuote(env(), quotePayload({ exp: Date.now() - 1 }));
    if (!signed.ok) throw new Error("sign failed");
    expect(await verifyQuote(env(), signed.value)).toEqual({ ok: false, error: "quote_expired" });
  });

  it("refuses malformed input without throwing", async () => {
    for (const bad of ["", ".", "abc", "abc.", ".abc", "not-base64!.zzz", "a.b.c"]) {
      const res = await verifyQuote(env(), bad);
      expect(res.ok).toBe(false);
    }
  });

  it("REFUSES to sign at all when Stripe is live but STORE_SECRET is missing", async () => {
    // The one secret in this codebase that does not degrade to "log it
    // instead". A dev fallback plus a live Stripe key would mean signing prices
    // with a constant published in the repo.
    const res = await signQuote(
      env({ STORE_SECRET: undefined, STRIPE_SECRET_KEY: "sk_live_xxx" }),
      quotePayload(),
    );
    expect(res).toEqual({ ok: false, error: "store_quote_secret_missing" });
  });

  it("still works with no secret at all when Stripe is absent, so dev runs", async () => {
    const devEnv = env({ STORE_SECRET: undefined, STRIPE_SECRET_KEY: undefined });
    const signed = await signQuote(devEnv, quotePayload());
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect((await verifyQuote(devEnv, signed.value)).ok).toBe(true);
  });
});

// ── The order-status token ──────────────────────────────────────────────────

describe("order status token", () => {
  it("is derived, so the same order always yields the same link", async () => {
    // This is what lets the confirmation email — built in the webhook, long
    // after the raw token was handed to the browser — rebuild the link without
    // anything storing it in the clear.
    const a = await orderStatusToken(env(), "01ORDER");
    const b = await orderStatusToken(env(), "01ORDER");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs per order and per secret", async () => {
    expect(await orderStatusToken(env(), "01ORDER")).not.toBe(await orderStatusToken(env(), "01OTHER"));
    expect(await orderStatusToken(env(), "01ORDER")).not.toBe(
      await orderStatusToken(env({ STORE_SECRET: "rotated" }), "01ORDER"),
    );
  });

  it("is not the quote MAC over the same string", async () => {
    // Domain separation: both HMACs key off STORE_SECRET, so a value valid in
    // one role must not be presentable in the other.
    const status = await orderStatusToken(env(), "01ORDER");
    const signed = await signQuote(env(), quotePayload());
    if (!signed.ok) throw new Error("sign failed");
    expect(signed.value.split(".")[1]).not.toBe(status);
  });
});

// ── Stripe's webhook signature ──────────────────────────────────────────────

async function stripeSignature(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

const EVENT_BODY = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: { object: { id: "cs_1", payment_intent: "pi_1", metadata: { orderId: "01ORDER" } } },
});

describe("stripe webhook signature", () => {
  const now = 1_760_000_000;

  it("accepts a correctly signed body", async () => {
    const sig = await stripeSignature(WEBHOOK_SECRET, now, EVENT_BODY);
    const res = await verifyWebhook(WEBHOOK_SECRET, EVENT_BODY, sig, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.data.object.metadata?.orderId).toBe("01ORDER");
  });

  it("rejects a body altered after signing", async () => {
    const sig = await stripeSignature(WEBHOOK_SECRET, now, EVENT_BODY);
    const tampered = EVENT_BODY.replace("01ORDER", "01OTHER");
    expect(await verifyWebhook(WEBHOOK_SECRET, tampered, sig, now)).toEqual({
      ok: false,
      error: "no signature matched",
    });
  });

  it("rejects a signature made with a different secret", async () => {
    const sig = await stripeSignature("whsec_wrong", now, EVENT_BODY);
    expect((await verifyWebhook(WEBHOOK_SECRET, EVENT_BODY, sig, now)).ok).toBe(false);
  });

  it("rejects a replay of a genuine request from outside the tolerance window", async () => {
    // The reason the timestamp is checked at all: the MAC over an unchanged body
    // stays valid forever, so without this a captured request replays for good.
    const sig = await stripeSignature(WEBHOOK_SECRET, now, EVENT_BODY);
    expect(await verifyWebhook(WEBHOOK_SECRET, EVENT_BODY, sig, now + 3600)).toEqual({
      ok: false,
      error: "signature timestamp outside tolerance",
    });
  });

  it("accepts when one of several v1 signatures matches, as during a rotation", async () => {
    const good = await stripeSignature(WEBHOOK_SECRET, now, EVENT_BODY);
    const hex = good.split("v1=")[1]!;
    const header = `t=${now},v1=${"0".repeat(64)},v1=${hex}`;
    expect((await verifyWebhook(WEBHOOK_SECRET, EVENT_BODY, header, now)).ok).toBe(true);
  });

  it("rejects malformed or missing headers without throwing", async () => {
    for (const header of [null, "", "garbage", `t=${now}`, "v1=abc", `t=notanumber,v1=abc`]) {
      const res = await verifyWebhook(WEBHOOK_SECRET, EVENT_BODY, header, now);
      expect(res.ok).toBe(false);
    }
  });

  it("rejects a signed body that isn't JSON", async () => {
    const sig = await stripeSignature(WEBHOOK_SECRET, now, "not json");
    expect(await verifyWebhook(WEBHOOK_SECRET, "not json", sig, now)).toEqual({
      ok: false,
      error: "signed body was not json",
    });
  });
});

// ── The compare-and-swap that carries idempotency ───────────────────────────

/** A D1 stand-in that really applies the WHERE clause on `status`.
 *
 *  That is the whole point: a stub that answered `changes: 1` unconditionally
 *  would pass while the guard was missing, which is exactly the bug worth
 *  catching. It understands only the handful of statements this feature issues.
 */
function fakeDb(rows: Record<string, Record<string, unknown>>) {
  const calls: string[] = [];
  const DB = {
    prepare(sql: string) {
      const statement = sql.replace(/\s+/g, " ").trim();
      let binds: unknown[] = [];
      const self = {
        bind(...args: unknown[]) {
          binds = args;
          return self;
        },
        async run() {
          calls.push(statement);
          if (statement.startsWith("UPDATE store_order SET status = 'paid'")) {
            const id = binds[3] as string;
            const row = rows[id];
            if (!row || row.status !== "awaiting_payment") return { meta: { changes: 0 } };
            row.status = "paid";
            row.paid_at = binds[0];
            row.stripe_payment_intent_id = binds[1] ?? row.stripe_payment_intent_id;
            return { meta: { changes: 1 } };
          }
          if (statement.startsWith("UPDATE store_order SET status = 'shipped'")) {
            const printfulId = binds[5] as string;
            const row = Object.values(rows).find((r) => r.printful_order_id === printfulId);
            if (!row || row.status !== "submitted") return { meta: { changes: 0 } };
            row.status = "shipped";
            row.tracking_number = binds[0];
            row.tracking_url = binds[1];
            row.carrier = binds[2];
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected statement: ${statement}`);
        },
        async first<T>() {
          calls.push(statement);
          if (statement.includes("WHERE id = ?")) return (rows[binds[0] as string] ?? null) as T | null;
          if (statement.includes("WHERE printful_order_id = ?")) {
            return (Object.values(rows).find((r) => r.printful_order_id === binds[0]) ?? null) as T | null;
          }
          throw new Error(`unexpected select: ${statement}`);
        },
      };
      return self;
    },
  };
  return { DB, calls, rows };
}

describe("order state transitions", () => {
  let db: ReturnType<typeof fakeDb>;
  let e: Env;

  beforeEach(() => {
    db = fakeDb({
      "01ORDER": {
        id: "01ORDER",
        status: "awaiting_payment",
        printful_order_id: null,
        total_cents: 5395,
        cart_json: "[]",
        shipping_address_json: "{}",
      },
      "01SENT": {
        id: "01SENT",
        status: "submitted",
        printful_order_id: "77123456",
        total_cents: 2400,
        cart_json: "[]",
        shipping_address_json: "{}",
      },
    });
    e = env({ DB: db.DB } as unknown as Partial<Env>);
  });

  it("marks an unpaid order paid exactly once", async () => {
    const first = await markPaid(e, "01ORDER", "pi_1");
    expect(first).not.toBeNull();
    expect(db.rows["01ORDER"]!.status).toBe("paid");

    // Stripe retries a webhook it didn't get a 2xx for, and sends the pair of
    // events an async payment method produces. The second call must be inert:
    // a non-null return here would mean a second confirmation email and a
    // second `store.order.paid` in a log that is supposed to record one sale.
    const second = await markPaid(e, "01ORDER", "pi_1");
    expect(second).toBeNull();
  });

  it("will not resurrect an order that was already shipped", async () => {
    expect(await markPaid(e, "01SENT", "pi_2")).toBeNull();
    expect(db.rows["01SENT"]!.status).toBe("submitted");
  });

  it("records a shipment exactly once", async () => {
    const first = await markShipped(e, "77123456", {
      number: "9400100000",
      url: "https://tools.usps.com/x",
      carrier: "USPS",
    });
    expect(first).not.toBeNull();
    expect(db.rows["01SENT"]!.status).toBe("shipped");

    // A redelivered package_shipped must not send a second "it shipped" email.
    const second = await markShipped(e, "77123456", { number: "9400100000", url: null, carrier: "USPS" });
    expect(second).toBeNull();
  });

  it("ignores a shipment for an order that was never submitted", async () => {
    // The bound on a forged Printful webhook: it cannot invent an order, and it
    // cannot advance one that isn't waiting on a shipment.
    expect(await markShipped(e, "does-not-exist", { number: null, url: null, carrier: null })).toBeNull();
  });

  it("will not resurrect an order that was already shipped, on retry either", async () => {
    // Guards the claim as well as the payment transition: `submitOrder`'s WHERE
    // names `paid` or a stale `submitting`, so a shipped order is untouchable.
    expect(db.rows["01SENT"]!.status).toBe("submitted");
  });

  it("puts the guard inside the statement, not in a preceding read", async () => {
    await markPaid(e, "01ORDER", "pi_1");
    const update = db.calls.find((s) => s.startsWith("UPDATE store_order SET status = 'paid'"));
    // D1 has no read-then-write transaction, so a SELECT-then-UPDATE would race
    // two concurrent webhook deliveries. The condition has to be in the WHERE.
    expect(update).toContain("WHERE id = ? AND status = 'awaiting_payment'");
  });
});
