// The storefront's anonymous half — the catalog, the cart's pricing, checkout,
// and the token-gated order page.
//
// Deliberately unauthenticated, the same way routes/calendarPublic.ts,
// routes/ics.ts, routes/newsletterPublic.ts and routes/volunteersPublic.ts are:
// no handler here calls requireAuth, and that absence IS the mechanism. It does
// read `c.var.auth` opportunistically — the session middleware runs on `*`, so a
// signed-in member's order gets a `user_id` without anyone having to sign in to
// buy a t-shirt.
//
// Two rules hold this file:
//
//   No price is ever read from a request body. `priceCart` reads every amount
//   from `store_product`, and checkout uses the amounts frozen into a quote we
//   signed. There is no code path here that would trust a client's number.
//
//   Everything a browser gets goes through `publicProductOf` or `orderStatusOf`,
//   which are hand-written field by field. If you are adding a field and it is
//   a Printful id, a Stripe id, a cost, a margin or an internal status, it does
//   not belong on this side of the seam.

import { Hono } from "hono";
import type { StoreAddressInput, StoreCartItemInput } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { getShippingRates, type PrintfulRate, type PrintfulResult } from "../lib/printful.js";
import {
  StoreError,
  listProducts,
  priceCart,
  productBySlug,
  publicProductOf,
  type PricedCart,
} from "../lib/store.js";
import { orderByStatusToken, orderStatusOf, startCheckout } from "../lib/storeOrder.js";
import { QUOTE_TTL_MS, signQuote, verifyQuote } from "../lib/storeQuote.js";

export const storePublic = new Hono<HonoEnv>();

const MAX_FIELD = 120;

/** One wording for one failure. The two rate call sites said it slightly
 *  differently, which reads to a shopper like two different problems. */
const RATES_FAILED = "We couldn't work out shipping to that address. Please check it and try again.";

function bad(message: string) {
  return { error: "invalid", message } as const;
}

/** Trim, cap and require. Addresses are typed by a stranger, so nothing here
 *  trusts a length or a shape. */
function field(value: unknown, name: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new StoreError(`${name} is required.`);
  if (s.length > MAX_FIELD) throw new StoreError(`${name} is too long.`);
  return s;
}

function optional(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, MAX_FIELD) : null;
}

function coerceAddress(raw: unknown): StoreAddressInput {
  const a = (raw ?? {}) as Record<string, unknown>;
  const country = field(a.country, "Country").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new StoreError("Country must be a two-letter code.");
  const state = field(a.state, "State").toUpperCase();
  return {
    name: field(a.name, "Name"),
    line1: field(a.line1, "Street address"),
    line2: optional(a.line2),
    city: field(a.city, "City"),
    state,
    postalCode: field(a.postalCode, "ZIP or postal code"),
    country,
    phone: optional(a.phone),
  };
}

function coerceEmail(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  // Deliberately loose: the confirmation email either arrives or it doesn't, and
  // a clever regex rejecting a valid address costs a sale.
  if (!s || s.length > MAX_FIELD || !s.includes("@")) throw new StoreError("A valid email is required.");
  return s;
}

/** Ask Printful what it costs to ship this cart to this address.
 *
 *  Both `/shipping-rates` and `/quote` need it — the first to show the options,
 *  the second to re-price the one that was chosen — and they must ask the SAME
 *  question, or a buyer could be shown one set of options and charged from
 *  another. One function is what keeps that true.
 *
 *  Note the ids: v1 prices the BLANK garment, so this passes catalog variant
 *  ids, where `POST /orders` later passes sync variant ids. Swapping the two
 *  returns an empty rate list rather than an error, which is why both are
 *  cached on every variant. */
function ratesFor(
  env: HonoEnv["Bindings"],
  address: StoreAddressInput,
  cart: PricedCart,
): Promise<PrintfulResult<PrintfulRate[]>> {
  return getShippingRates(env, {
    recipient: {
      address1: address.line1,
      city: address.city,
      stateCode: address.state,
      countryCode: address.country,
      zip: address.postalCode,
    },
    items: cart.printful.map((p) => ({
      catalogVariantId: p.catalogVariantId,
      quantity: p.quantity,
    })),
  });
}

function coerceItems(raw: unknown): StoreCartItemInput[] {
  if (!Array.isArray(raw)) throw new StoreError("Your cart is empty.");
  return raw.map((i) => {
    const item = (i ?? {}) as Record<string, unknown>;
    return { variantId: String(item.variantId ?? ""), quantity: Number(item.quantity ?? 0) };
  });
}

// ── Catalog ─────────────────────────────────────────────────────────────────

/** GET /store-public/products — the storefront grid. */
storePublic.get("/products", async (c) => {
  const rows = await listProducts(c.env, true);
  return c.json({ products: rows.map(publicProductOf) });
});

/** GET /store-public/products/:slug — one product page.
 *
 *  The published filter is in SQL (see `productBySlug`), so an unpublished
 *  product 404s rather than being fetched and then hidden — a guessed slug
 *  reveals nothing about what is being prepared. */
storePublic.get("/products/:slug", async (c) => {
  const row = await productBySlug(c.env, c.req.param("slug"), true);
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ product: publicProductOf(row) });
});

// ── Cart → quote → checkout ─────────────────────────────────────────────────

/** POST /store-public/shipping-rates { items, address } — what the options are.
 *
 *  Returns UNSIGNED options for the cart to render. Nothing here commits to a
 *  price: the buyer picks a method and `/quote` re-asks Printful for that one,
 *  which is what stops a client asserting its own shipping cost by echoing back
 *  a number from this response. */
storePublic.post("/shipping-rates", async (c) => {
  try {
    const body = await c.req.json<{ items?: unknown; address?: unknown }>();
    const address = coerceAddress(body.address);
    const cart = await priceCart(c.env, coerceItems(body.items));

    const rates = await ratesFor(c.env, address, cart);
    if (!rates.ok) return c.json(bad(RATES_FAILED), 400);
    if (rates.value.length === 0) {
      return c.json(bad("We can't ship to that address."), 400);
    }

    return c.json({
      lines: cart.lines,
      subtotalCents: cart.subtotalCents,
      rates: rates.value,
      currency: "usd",
    });
  } catch (err) {
    if (err instanceof StoreError) return c.json(bad(err.message), 400);
    throw err;
  }
});

/** POST /store-public/quote { items, address, email, rateId } — freeze it.
 *
 *  Re-prices the cart from `store_product` and re-asks Printful for the chosen
 *  method, then signs the whole thing as one unit. From here to checkout, the
 *  numbers are ours and the client can't edit any part without invalidating the
 *  signature over all of it. */
storePublic.post("/quote", async (c) => {
  try {
    const body = await c.req.json<{ items?: unknown; address?: unknown; email?: unknown; rateId?: unknown }>();
    const address = coerceAddress(body.address);
    const email = coerceEmail(body.email);
    const rateId = field(body.rateId, "Shipping method");
    const cart = await priceCart(c.env, coerceItems(body.items));

    const rates = await ratesFor(c.env, address, cart);
    if (!rates.ok) return c.json(bad(RATES_FAILED), 400);

    // The rate is looked up in Printful's fresh answer, never taken from the
    // request — `rateId` only selects among options Printful just offered.
    const chosen = rates.value.find((r) => r.id === rateId);
    if (!chosen) return c.json(bad("That shipping option is no longer available."), 409);

    const totalCents = cart.subtotalCents + chosen.amountCents;
    const signed = await signQuote(c.env, {
      email,
      address,
      lines: cart.lines,
      subtotalCents: cart.subtotalCents,
      shippingRateId: chosen.id,
      shippingLabel: chosen.label,
      shippingCents: chosen.amountCents,
      totalCents,
      currency: "usd",
      exp: Date.now() + QUOTE_TTL_MS,
    });
    if (!signed.ok) return c.json({ error: "unavailable" }, 503);

    return c.json({
      token: signed.value,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
      lines: cart.lines,
      subtotalCents: cart.subtotalCents,
      shippingLabel: chosen.label,
      shippingCents: chosen.amountCents,
      totalCents,
      currency: "usd",
    });
  } catch (err) {
    if (err instanceof StoreError) return c.json(bad(err.message), 400);
    throw err;
  }
});

/** POST /store-public/checkout { token } — mint the order and hand back a URL.
 *
 *  A signed-in buyer's order is attached to their account here; a guest's is
 *  not, and reaches them through the status link in their confirmation email.
 *  Nothing about the two paths differs except that one line. */
storePublic.post("/checkout", async (c) => {
  try {
    const body = await c.req.json<{ token?: unknown }>();
    const token = String(body.token ?? "");
    const quote = await verifyQuote(c.env, token);
    if (!quote.ok) {
      // An expired quote is the ordinary case — the buyer left the tab open —
      // and the cart re-quotes silently and shows the new total before paying.
      const status = quote.error === "quote_expired" ? 409 : 400;
      return c.json({ error: quote.error }, status);
    }

    const { checkoutUrl } = await startCheckout(c.env, quote.value, c.var.auth ?? null);
    return c.json({ checkoutUrl });
  } catch (err) {
    if (err instanceof StoreError) return c.json(bad(err.message), 409);
    throw err;
  }
});

// ── Order status ────────────────────────────────────────────────────────────

/** GET /store-public/orders/:token — one order, for whoever holds the link.
 *
 *  Holding the token IS the authorization, invariant 15's rule, which is why the
 *  page that renders this is `no-store`: a shared cache keyed on the URL would
 *  serve a stranger the same body. The lookup is on the token's HASH, so the
 *  stored column is not itself a working link. */
storePublic.get("/orders/:token", async (c) => {
  const row = await orderByStatusToken(c.env, c.req.param("token"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ order: orderStatusOf(row) });
});
