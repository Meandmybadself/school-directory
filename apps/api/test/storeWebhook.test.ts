// `checkout.session.completed` is not proof that money moved.
//
// This is the most expensive mistake available in this feature, and it is
// invisible in a card-only test account. For a DELAYED payment method — ACH
// debit, a bank transfer, a voucher — Stripe fires `checkout.session.completed`
// the moment the buyer finishes the form, carrying `payment_status: "unpaid"`,
// and the money settles days later or not at all. `createCheckoutSession` does
// not restrict `payment_method_types`, so whichever methods are enabled in the
// dashboard apply — meaning this path is one dashboard toggle away from live at
// any time, with no code change to notice.
//
// Fulfilling on `completed` alone therefore submits an order to Printful (who
// bill the PTO to print and ship it) and emails the buyer a receipt, for a
// payment that may never arrive — and if the debit later bounces, nothing
// reconciles it.
//
// So three properties are pinned here:
//
//   1. `completed` with `payment_status: "unpaid"` changes NOTHING.
//   2. `async_payment_succeeded` — the event that does mean the money landed —
//      is what advances such an order.
//   3. `async_payment_failed` closes it out rather than leaving it hanging.
//
// Written at the ROUTE, not the lib, because the bug lives in which event the
// router chooses to act on; `markPaid` itself was always correct.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditDraft } from "../src/lib/audit.js";
import type { HonoEnv } from "../src/env.js";

const mocks = vi.hoisted(() => ({
  markPaid: vi.fn(),
  markShipped: vi.fn(),
  submitOrder: vi.fn(),
  sendOrderConfirmation: vi.fn(),
  sendShippedEmail: vi.fn(),
}));
vi.mock("../src/lib/storeOrder.js", () => mocks);

const { markPaid, submitOrder, sendOrderConfirmation } = mocks;
const { storeWebhooks } = await import("../src/routes/storeWebhooks.js");

const WEBHOOK_SECRET = "whsec_test";

const ORDER = {
  id: "01ORDER",
  email: "buyer@example.com",
  total_cents: 5395,
  cart_json: JSON.stringify([{ quantity: 2 }]),
  shipping_address_json: JSON.stringify({ city: "Hopkins", state: "MN" }),
};

let audit: AuditDraft[] = [];
/** Every statement the handler ran, so "did it write anything?" is answerable. */
let statements: string[] = [];

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      audit = [];
      c.set("audit", audit);
      c.set("ip", null);
      c.set("userAgent", null);
      await next();
    }),
  );
  a.route("/store-webhooks", storeWebhooks);
  a.onError(() => new Response("internal", { status: 500 }));
  return a;
}

const DB = {
  prepare(sql: string) {
    const statement = sql.replace(/\s+/g, " ").trim();
    const self = {
      bind: () => self,
      run: async () => {
        statements.push(statement);
        return { meta: { changes: 1 } };
      },
    };
    return self;
  },
};

const env = { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, DB } as unknown as HonoEnv["Bindings"];
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function sign(body: string): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

async function send(type: string, object: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify({ id: "evt_1", type, data: { object } });
  return app().request(
    "/store-webhooks/stripe",
    { method: "POST", headers: { "stripe-signature": await sign(body) }, body },
    env,
    ctx,
  );
}

const session = (extra: Record<string, unknown>) => ({
  id: "cs_1",
  payment_intent: "pi_1",
  metadata: { orderId: "01ORDER" },
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  statements = [];
  markPaid.mockResolvedValue(ORDER);
});

describe("checkout.session.completed", () => {
  it("fulfils a synchronous payment", async () => {
    const res = await send("checkout.session.completed", session({ payment_status: "paid" }));
    expect(res.status).toBe(200);
    expect(markPaid).toHaveBeenCalledWith(expect.anything(), "01ORDER", "pi_1");
    expect(submitOrder).toHaveBeenCalled();
    expect(sendOrderConfirmation).toHaveBeenCalled();
    expect(audit.map((d) => d.action)).toEqual(["store.order.paid"]);
  });

  it("does NOT fulfil when payment_status says the money hasn't arrived", async () => {
    // The whole point. An ACH debit reaches this line before any money moves.
    const res = await send("checkout.session.completed", session({ payment_status: "unpaid" }));
    expect(res.status).toBe(200);
    expect(markPaid).not.toHaveBeenCalled();
    expect(submitOrder).not.toHaveBeenCalled();
    // No receipt for a payment that hasn't happened, and no sale in the log.
    expect(sendOrderConfirmation).not.toHaveBeenCalled();
    expect(audit).toEqual([]);
    expect(statements).toEqual([]);
  });

  it("fulfils a zero-total session, which is legitimately 'no payment required'", async () => {
    const res = await send(
      "checkout.session.completed",
      session({ payment_status: "no_payment_required" }),
    );
    expect(res.status).toBe(200);
    expect(markPaid).toHaveBeenCalled();
  });

  it("does not fulfil when payment_status is absent entirely", async () => {
    // Fail closed: an event shape we don't recognise must not be read as paid.
    await send("checkout.session.completed", session({}));
    expect(markPaid).not.toHaveBeenCalled();
  });
});

describe("the delayed-payment pair", () => {
  it("fulfils on async_payment_succeeded, which is the event that means paid", async () => {
    const res = await send("checkout.session.async_payment_succeeded", session({ payment_status: "paid" }));
    expect(res.status).toBe(200);
    expect(markPaid).toHaveBeenCalledWith(expect.anything(), "01ORDER", "pi_1");
    expect(submitOrder).toHaveBeenCalled();
  });

  it("closes the order out when the debit bounces", async () => {
    const res = await send("checkout.session.async_payment_failed", session({ payment_status: "unpaid" }));
    expect(res.status).toBe(200);
    expect(markPaid).not.toHaveBeenCalled();
    // Guarded on `awaiting_payment`, so it cannot reach back and undo an order
    // that was paid on a second attempt.
    expect(statements.join(" ")).toContain("status = 'abandoned'");
    expect(statements.join(" ")).toContain("AND status = 'awaiting_payment'");
  });
});

describe("redelivery", () => {
  it("reports a sale once, however many times Stripe sends the event", async () => {
    // `markPaid` returns null when its guarded UPDATE changed nothing — which is
    // what a redelivery gets. Nothing downstream may run on that.
    markPaid.mockResolvedValueOnce(ORDER).mockResolvedValue(null);

    await send("checkout.session.completed", session({ payment_status: "paid" }));
    expect(audit.map((d) => d.action)).toEqual(["store.order.paid"]);

    await send("checkout.session.completed", session({ payment_status: "paid" }));
    expect(audit).toEqual([]);
    expect(sendOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(submitOrder).toHaveBeenCalledTimes(1);
  });
});

describe("what never reaches Slack", () => {
  it("keeps the buyer's email and address out of the notify bag", async () => {
    await send("checkout.session.completed", session({ payment_status: "paid" }));
    const draft = audit[0]!;
    expect(JSON.stringify(draft.notify)).not.toContain("buyer@example.com");
    // The town is allowed; the street and the name are not, and neither is here.
    expect(draft.notify).toEqual({ totalCents: 5395, itemCount: 2, city: "Hopkins", state: "MN" });
  });
});
