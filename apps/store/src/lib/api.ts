// Thin fetch client, the same shape as the directory, calendar and newsletter
// apps'. Points at the SAME API Worker: the session cookie is host-only to that
// Worker and every SPA lives on an eisenhower.school subdomain, so credentialed
// requests carry it with no cross-domain cookie tricks. The API must list this
// origin in ALLOWED_ORIGINS.
//
// One thing here differs from the sibling apps: most of these calls work SIGNED
// OUT. Buying does not require an account (a grandparent should not have to
// receive a magic link to order a hoodie), so `credentials: "include"` is about
// ATTACHING an order to a member who happens to be signed in, not about
// permitting the purchase.
import type {
  MeDTO,
  PublicStoreOrderDTO,
  PublicStoreProductDTO,
  StoreAddressInput,
  StoreCartItemInput,
  StoreCheckoutDTO,
  StoreOrderDTO,
  StorePrintfulCatalogItemDTO,
  StoreProductDTO,
  StoreProductPatchBody,
  StoreQuoteDTO,
  StoreShippingRatesDTO,
  Locale,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** Sibling apps — linked to from nav; not API bases. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";
export const CALENDAR_URL = import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174";
export const NEWSLETTER_URL = import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

/** The server's human-readable reason, when it sent one. The store leans on
 *  this more than its siblings: "that size is out of stock" and "your quote
 *  expired" are things a shopper has to be told in words. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const msg = (err.body as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

/** The machine-readable code, for the few cases the cart handles itself rather
 *  than showing text — an expired quote is silently re-quoted. */
export function errorCode(err: unknown): string | null {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const code = (err.body as { error?: unknown }).error;
    if (typeof code === "string") return code;
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  if (isMutation && navigator.onLine === false) {
    throw new ApiError(0, { error: "offline" });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }) satisfies RequestInit;

export const api = {
  // Auth — admins only, in practice. `returnTo` is this app's origin, so the
  // magic link comes back here rather than to the directory.
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", post({ email, returnTo: window.location.origin })),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),
  me: () => request<MeDTO>("/me"),
  setLocale: (locale: Locale) =>
    request<{ ok: true }>("/me/locale", { method: "PUT", body: JSON.stringify({ locale }) }),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),

  // ── Storefront (anonymous) ──
  products: () => request<{ products: PublicStoreProductDTO[] }>("/store-public/products"),
  product: (slug: string) =>
    request<{ product: PublicStoreProductDTO }>(`/store-public/products/${encodeURIComponent(slug)}`),

  /** Step one of the address-first cart: what the options cost. */
  shippingRates: (items: StoreCartItemInput[], address: StoreAddressInput) =>
    request<StoreShippingRatesDTO>("/store-public/shipping-rates", post({ items, address })),

  /** Step two: freeze the chosen option into a signed quote. */
  quote: (items: StoreCartItemInput[], address: StoreAddressInput, email: string, rateId: string) =>
    request<StoreQuoteDTO>("/store-public/quote", post({ items, address, email, rateId })),

  /** Step three: mint the order and hand back Stripe's URL. */
  checkout: (token: string) => request<StoreCheckoutDTO>("/store-public/checkout", post({ token })),

  orderStatus: (token: string) =>
    request<{ order: PublicStoreOrderDTO }>(`/store-public/orders/${encodeURIComponent(token)}`),

  // ── A signed-in buyer's own orders ──
  myOrders: () => request<{ orders: StoreOrderDTO[] }>("/store/orders/mine"),

  // ── Admin ──
  printfulCatalog: () => request<{ items: StorePrintfulCatalogItemDTO[] }>("/store/printful-catalog"),
  adminProducts: () => request<{ products: StoreProductDTO[] }>("/store/products"),
  importProduct: (printfulSyncProductId: string) =>
    request<{ product: StoreProductDTO }>("/store/products", post({ printfulSyncProductId })),
  patchProduct: (id: string, body: StoreProductPatchBody) =>
    request<{ product: StoreProductDTO }>(`/store/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  syncProduct: (id: string) =>
    request<{ product: StoreProductDTO }>(`/store/products/${id}/sync`, { method: "POST" }),
  adminOrders: (status?: string) =>
    request<{ orders: StoreOrderDTO[] }>(`/store/orders${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  retryOrder: (id: string) =>
    request<{ order: StoreOrderDTO | null }>(`/store/orders/${id}/retry`, { method: "POST" }),
};

/** Re-exported so a tile, a cart line and the confirmation email all render a
 *  price through one function — see formatMoney in @sd/shared. */
export { formatMoney as money } from "@sd/shared";
