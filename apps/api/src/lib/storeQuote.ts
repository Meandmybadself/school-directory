// The shipping quote, as an HMAC-signed token rather than a row.
//
// WHY NO TABLE. A quote is single-use, lives thirty minutes, has exactly one
// consumer (this API, which signs it and later verifies it), and nothing joins,
// counts or lists it. It fails every test the other domain tables here pass:
// volunteer_signup is counted, newsletter_confirmation backs a rate limit that
// has to survive a crash, auth_token is claimed. A quote is none of those. What
// it actually needs is to be unforgeable across a round trip through a browser,
// and that is a signature, not a primary key.
//
// WHY HMAC AND NOT sha256. lib/crypto.ts's `sha256` is used elsewhere over
// server-known inputs — chainHash, token_hash — where an attacker never controls
// the plaintext. Here they control all of it: a bare hash of a payload the
// client can read and rewrite protects nothing, because they can hash their own.
// A keyed MAC is the minimum correct primitive.
//
// WHY IT IS NOT IN packages/shared. Invariant 9 puts the newsletter renderer
// there because three surfaces render an issue and drift between them is the
// bug. This token has one consumer and the frontend never inspects it — it is an
// opaque string the cart stores and echoes back. Putting it in the shared
// package would be adding an abstraction because a sibling feature has one.
//
// ON REPLAY. Nothing marks a token spent, and that is deliberate rather than an
// omission. Presenting one twice mints two `awaiting_payment` orders and two
// Stripe sessions; the buyer completes at most one, and the other is swept to
// `abandoned` (migration 0022). Charging twice requires deliberately paying
// twice. The alternative — a consumed-tokens table — would reintroduce exactly
// the row this design removed, to prevent something that isn't a loss.

import type { StoreAddressInput, StoreLineDTO } from "@sd/shared";
import type { Env } from "../env.js";
import { MINUTES } from "./time.js";

/** Long enough to fill in a card, short enough that a Printful rate or an
 *  admin's re-price can't ride through stale. */
export const QUOTE_TTL_MS = 30 * MINUTES;

/** Everything a checkout needs, signed as one unit so no part can be edited
 *  independently of the rest — swapping the address would invalidate the
 *  shipping price, and swapping a line would invalidate the total. */
export interface QuotePayload {
  email: string;
  address: StoreAddressInput;
  lines: StoreLineDTO[];
  subtotalCents: number;
  shippingRateId: string;
  shippingLabel: string;
  shippingCents: number;
  totalCents: number;
  currency: string;
  /** Epoch milliseconds. */
  exp: number;
}

export type QuoteResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Only used when no STORE_SECRET is set AND no Stripe key is set — i.e.
 *  local development, where nothing can take money. See `storeSecret`. */
const DEV_SECRET = "dev-only-store-secret";

/** STORE_SECRET keys two unrelated things — quote tokens here and order-status
 *  tokens in lib/storeOrder.ts — so every message signed under it is prefixed
 *  with what it is. Without that, a value that happened to be valid in one role
 *  would be valid in the other; with it, the two MACs are over disjoint input
 *  spaces and neither can be presented as the other. */
const QUOTE_DOMAIN = "store-quote.v1:";

/**
 * The signing key, or a refusal.
 *
 * The fallback is gated on Stripe being unconfigured too, and that pairing is
 * the whole point. Every other optional secret in this codebase degrades to
 * "log it instead" because the worst case is an unsent email. A guessable quote
 * key is different in kind: a forged quote is a forged PRICE, so an instance
 * that could take a card while signing with a published constant would sell
 * merchandise for whatever the buyer typed. So the dev fallback exists only in
 * the configuration where no card can be charged, and the moment
 * STRIPE_SECRET_KEY is present the secret becomes mandatory.
 */
export function storeSecret(env: Env): QuoteResult<string> {
  if (env.STORE_SECRET) return { ok: true, value: env.STORE_SECRET };
  if (env.STRIPE_SECRET_KEY) {
    console.error("[store] STRIPE_SECRET_KEY is set but STORE_SECRET is not — refusing to sign quotes");
    return { ok: false, error: "store_quote_secret_missing" };
  }
  return { ok: true, value: DEV_SECRET };
}

function b64urlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/** `<base64url payload>.<base64url mac>`. */
export async function signQuote(env: Env, payload: QuotePayload): Promise<QuoteResult<string>> {
  const secret = storeSecret(env);
  if (!secret.ok) return secret;

  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret.value, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(QUOTE_DOMAIN + body));
  return { ok: true, value: `${body}.${b64urlEncode(new Uint8Array(mac))}` };
}

/**
 * Check a token and return what it says, or say why not.
 *
 * Order matters: the MAC is checked before the payload is parsed, and the
 * expiry before anything is trusted. Verification goes through
 * `crypto.subtle.verify` rather than comparing strings, so it is constant-time.
 */
export async function verifyQuote(env: Env, token: string): Promise<QuoteResult<QuotePayload>> {
  const secret = storeSecret(env);
  if (!secret.ok) return secret;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, error: "quote_malformed" };
  const body = token.slice(0, dot);
  const mac = b64urlDecode(token.slice(dot + 1));
  if (!mac) return { ok: false, error: "quote_malformed" };

  const key = await hmacKey(secret.value, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    mac as BufferSource,
    new TextEncoder().encode(QUOTE_DOMAIN + body),
  );
  if (!valid) return { ok: false, error: "quote_invalid" };

  const raw = b64urlDecode(body);
  if (!raw) return { ok: false, error: "quote_malformed" };
  let payload: QuotePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as QuotePayload;
  } catch {
    return { ok: false, error: "quote_malformed" };
  }

  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) {
    return { ok: false, error: "quote_expired" };
  }
  return { ok: true, value: payload };
}
