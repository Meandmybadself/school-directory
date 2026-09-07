// The cart, in localStorage.
//
// There is no server-side cart table, and that is the point rather than a
// shortcut. A cart holds variant ids and quantities — nothing private, nothing
// anyone else needs to see, and nothing that commits money. The moment it
// becomes a commitment it stops being this and becomes a signed quote, and then
// a `store_order` row. A `store_cart` table would carry all the obligations of
// real state (retention, a sweep, an abandoned-cart notion) for something a
// browser can hold perfectly well on its own.
//
// It stores VARIANT ids, which are ours, not Printful's — so a cart left open
// across the day the catalog is re-pointed at a different Printful store still
// resolves (migration 0022). It does NOT store prices: the server reads every
// amount from `store_product`, and a price cached here would only be a number
// the checkout has to ignore.

import type { StoreCartItemInput } from "@sd/shared";

const KEY = "sd_store_cart";
const MAX_LINES = 20;
const MAX_QTY = 25;

/** What a line needs to render before the server has priced anything. Titles and
 *  images are a convenience copy so the cart paints instantly on load; every
 *  authoritative value comes back from `/shipping-rates`. */
export interface CartLine extends StoreCartItemInput {
  slug: string;
  title: string;
  variantLabel: string;
  imageUrl: string | null;
}

function isLine(v: unknown): v is CartLine {
  if (!v || typeof v !== "object") return false;
  const l = v as Record<string, unknown>;
  return typeof l.variantId === "string" && typeof l.quantity === "number" && typeof l.slug === "string";
}

/** Never throws. A browser with storage disabled, a private window, or a blob
 *  written by an older version of this app all resolve to an empty cart rather
 *  than a blank page. */
export function readCart(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLine).slice(0, MAX_LINES);
  } catch {
    return [];
  }
}

export function writeCart(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines.slice(0, MAX_LINES)));
  } catch {
    /* storage disabled; the cart lives for this page view only */
  }
  // So a header badge on another mounted component updates without prop
  // drilling. `storage` only fires cross-tab, hence the explicit event.
  window.dispatchEvent(new CustomEvent("sd-cart"));
}

export function addToCart(line: CartLine): CartLine[] {
  const lines = readCart();
  const existing = lines.find((l) => l.variantId === line.variantId);
  if (existing) existing.quantity = Math.min(MAX_QTY, existing.quantity + line.quantity);
  else lines.push({ ...line, quantity: Math.min(MAX_QTY, Math.max(1, line.quantity)) });
  writeCart(lines);
  return lines;
}

export function setQuantity(variantId: string, quantity: number): CartLine[] {
  const lines = readCart()
    .map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l))
    .filter((l) => l.quantity > 0);
  writeCart(lines);
  return lines;
}

export function removeFromCart(variantId: string): CartLine[] {
  const lines = readCart().filter((l) => l.variantId !== variantId);
  writeCart(lines);
  return lines;
}

export function clearCart(): void {
  writeCart([]);
}

export function cartCount(lines: CartLine[] = readCart()): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** What the API is sent. Deliberately narrower than what is stored: the server
 *  wants ids and counts, and re-derives everything else. */
export function cartItems(lines: CartLine[] = readCart()): StoreCartItemInput[] {
  return lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
}
