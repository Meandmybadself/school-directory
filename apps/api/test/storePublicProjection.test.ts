// The store's public/private seams — the companion to calendarPublic.test.ts
// and volunteersPublic.test.ts, written for the same reason and pinning the same
// two kinds of thing: that each projection emits exactly what it means to, and
// that a field added to the row or the admin DTO LATER cannot ride along.
//
// This seam guards three things those two do not.
//
//   VENDOR IDS. `store_product` carries Printful's sync-product id and, inside
//   variants_json, both of Printful's variant ids. None of them may reach a
//   browser — not because they are secret, but because they are the one part of
//   this schema that CHANGES when the catalog is re-pointed at a different
//   Printful store (migration 0022). A public shape that leaked one would have
//   made that day a breaking change for every open cart.
//
//   MONEY WE DON'T CHARGE. There is no wholesale-cost column anywhere, so there
//   is nothing to leak — but `fromPriceCents` is computed here, and a bug that
//   computed it from out-of-stock variants would advertise a price nobody can
//   buy.
//
//   A LIVE CAPABILITY. `store_order.status_token_hash` is the bearer secret for
//   the order page itself. `orderStatusOf` spreading its row would publish it on
//   the very page that hash is supposed to gate — issuePageOf's failure mode,
//   one feature along.

import { describe, expect, it } from "vitest";
import { publicProductOf } from "../src/lib/store.js";
import type { StoreProductRow } from "../src/lib/store.js";
import { orderStatusOf } from "../src/lib/storeOrder.js";
import type { StoreOrderRow } from "../src/lib/storeOrder.js";

/** Every key an anonymous shopper may see. Changing these lists is a deliberate
 *  act — if a test failure sent you here, confirm the new field is genuinely
 *  safe for a logged-out stranger before adding it. */
const PRODUCT_KEYS = ["slug", "title", "blurb", "imageUrl", "variants", "fromPriceCents"].sort();
const VARIANT_KEYS = ["id", "label", "imageUrl", "inStock", "priceCents"].sort();
const ORDER_KEYS = [
  "status",
  "lines",
  "subtotalCents",
  "shippingLabel",
  "shippingCents",
  "totalCents",
  "currency",
  "shipTo",
  "trackingNumber",
  "trackingUrl",
  "carrier",
  "placedAt",
  "shippedAt",
].sort();
const SHIP_TO_KEYS = ["name", "city", "state", "postalCode"].sort();

function productRow(overrides: Partial<StoreProductRow> = {}): StoreProductRow {
  return {
    id: "01PRODUCT",
    printful_sync_product_id: "389472001",
    slug: "eisenhower-spirit-tee",
    printful_title: "Eisenhower Spirit Tee",
    title_override: null,
    blurb: "Soft, and it survives the wash.",
    image_url: "https://files.cdn.printful.com/tee.png",
    sort_order: 10,
    published_at: "2026-08-01T00:00:00.000Z",
    variants_json: JSON.stringify([
      {
        id: "01VARSM",
        printfulSyncVariantId: "4771000",
        printfulCatalogVariantId: "4012",
        label: "Navy / S",
        imageUrl: "https://files.cdn.printful.com/tee-s.png",
        inStock: true,
        priceCents: 2400,
      },
      {
        id: "01VAR2XL",
        printfulSyncVariantId: "4771005",
        printfulCatalogVariantId: "4017",
        label: "Navy / 2XL",
        imageUrl: null,
        inStock: true,
        // Per-variant pricing: the 2XL upcharge is the whole reason price does
        // not live on the product.
        priceCents: 2700,
      },
      {
        id: "01VARGONE",
        printfulSyncVariantId: "4771009",
        printfulCatalogVariantId: "4021",
        label: "Navy / 3XL",
        imageUrl: null,
        inStock: false,
        priceCents: 1900,
      },
    ]),
    synced_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function orderRow(overrides: Partial<StoreOrderRow> = {}): StoreOrderRow {
  return {
    id: "01ORDER",
    user_id: "01USER",
    email: "buyer@example.com",
    status: "submitted",
    status_token_hash: "b1946ac92492d2347c6235b4d2611184",
    stripe_session_id: "cs_test_a1b2c3",
    stripe_payment_intent_id: "pi_test_a1b2c3",
    cart_json: JSON.stringify([
      {
        productId: "01PRODUCT",
        variantId: "01VARSM",
        title: "Eisenhower Spirit Tee",
        variantLabel: "Navy / S",
        imageUrl: null,
        unitPriceCents: 2400,
        quantity: 2,
      },
    ]),
    shipping_address_json: JSON.stringify({
      name: "Dana Ruiz",
      line1: "412 Maple Street",
      line2: "Apt 3",
      city: "Hopkins",
      state: "MN",
      postalCode: "55305",
      country: "US",
      phone: "612-555-0134",
    }),
    shipping_rate_id: "STANDARD",
    shipping_label: "Standard (3–5 business days)",
    subtotal_cents: 4800,
    shipping_cents: 595,
    total_cents: 5395,
    currency: "usd",
    printful_order_id: "77123456",
    submit_attempts: 1,
    last_submit_error: null,
    fulfillment_status: null,
    tracking_number: null,
    tracking_url: null,
    carrier: null,
    paid_at: "2026-09-02T14:00:00.000Z",
    submitted_at: "2026-09-02T14:00:05.000Z",
    shipped_at: null,
    created_at: "2026-09-02T13:58:00.000Z",
    updated_at: "2026-09-02T14:00:05.000Z",
    ...overrides,
  };
}

describe("publicProductOf", () => {
  it("emits exactly the public key set, at both levels", () => {
    const dto = publicProductOf(productRow());
    expect(Object.keys(dto).sort()).toEqual(PRODUCT_KEYS);
    for (const variant of dto.variants) {
      expect(Object.keys(variant).sort()).toEqual(VARIANT_KEYS);
    }
  });

  it("never lets a Printful id reach the response", () => {
    const dto = publicProductOf(productRow());
    const json = JSON.stringify(dto);
    // The sync product id, and both variant ids, as they appear on the row.
    expect(json).not.toContain("389472001");
    expect(json).not.toContain("4771000");
    expect(json).not.toContain("4012");

    // No `printful*` KEY anywhere. Checked on keys rather than on the whole
    // payload because image URLs are Printful CDN links on purpose — we
    // hot-link mockups rather than mirroring them into R2, so the HOST is
    // expected to appear and an id is not.
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        for (const [k, child] of Object.entries(v)) {
          keys.add(k);
          walk(child);
        }
      }
    };
    walk(dto);
    expect([...keys].filter((k) => /printful/i.test(k))).toEqual([]);
  });

  it("withholds merchandising bookkeeping", () => {
    const json = JSON.stringify(publicProductOf(productRow()));
    expect(json).not.toContain("01PRODUCT"); // the row id
    expect(json).not.toContain("2026-09-01"); // synced_at
    expect(json).not.toMatch(/sortOrder|published/);
  });

  it("cannot be widened from the row", () => {
    // The shape of the accident this guards: somebody adds a column and a
    // spread carries it out. Built field by field, an unknown column is simply
    // not copied.
    const widened = {
      ...productRow(),
      wholesale_cost_cents: 1150,
      internal_note: "reorder before the concert",
    } as StoreProductRow;
    const json = JSON.stringify(publicProductOf(widened));
    expect(json).not.toContain("1150");
    expect(json).not.toContain("reorder before the concert");
  });

  it("prices 'from' off the cheapest variant a shopper can actually buy", () => {
    // The 3XL at $19 is out of stock; advertising it would be a price nobody
    // can pay.
    expect(publicProductOf(productRow()).fromPriceCents).toBe(2400);
  });

  it("survives a corrupt variant cache without throwing", () => {
    const dto = publicProductOf(productRow({ variants_json: "{not json" }));
    expect(dto.variants).toEqual([]);
    expect(dto.fromPriceCents).toBe(0);
  });
});

describe("orderStatusOf", () => {
  it("emits exactly the token-holder's key set", () => {
    const dto = orderStatusOf(orderRow());
    expect(Object.keys(dto).sort()).toEqual(ORDER_KEYS);
    expect(Object.keys(dto.shipTo).sort()).toEqual(SHIP_TO_KEYS);
  });

  it("never carries the status token hash, or a vendor id", () => {
    const json = JSON.stringify(orderStatusOf(orderRow()));
    expect(json).not.toContain("b1946ac92492d2347c6235b4d2611184");
    expect(json).not.toContain("cs_test_a1b2c3");
    expect(json).not.toContain("pi_test_a1b2c3");
    expect(json).not.toContain("77123456");
    expect(json).not.toContain("01USER");
  });

  it("shows enough to recognise the parcel and no more of the address", () => {
    const json = JSON.stringify(orderStatusOf(orderRow()));
    expect(json).toContain("Hopkins");
    // A forwarded link should not hand a stranger someone's doorstep.
    expect(json).not.toContain("412 Maple Street");
    expect(json).not.toContain("Apt 3");
    expect(json).not.toContain("612-555-0134");
  });

  it("collapses internal states into what a buyer can act on", () => {
    expect(orderStatusOf(orderRow({ status: "paid" })).status).toBe("processing");
    expect(orderStatusOf(orderRow({ status: "submitting" })).status).toBe("processing");
    expect(orderStatusOf(orderRow({ status: "submitted" })).status).toBe("processing");
    expect(orderStatusOf(orderRow({ status: "shipped" })).status).toBe("shipped");
    expect(orderStatusOf(orderRow({ status: "fulfillment_failed" })).status).toBe("problem");
  });

  it("never leaks the operational reason a submission failed", () => {
    // `last_submit_error` is Printful's raw message. It is for the admin screen;
    // a buyer gets "problem" and a human follows up.
    const json = JSON.stringify(
      orderStatusOf(
        orderRow({ status: "fulfillment_failed", last_submit_error: "Variant 4771000 is discontinued" }),
      ),
    );
    expect(json).not.toContain("discontinued");
    expect(json).not.toContain("4771000");
  });

  it("cannot be widened from the row", () => {
    const widened = { ...orderRow(), stripe_charge_id: "ch_test_secret" } as StoreOrderRow;
    expect(JSON.stringify(orderStatusOf(widened))).not.toContain("ch_test_secret");
  });
});
