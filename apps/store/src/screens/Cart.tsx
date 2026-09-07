// The cart, and the address-first checkout it exists to drive.
//
// The flow, and why it has three steps rather than one:
//
//   lines → [address] → shipping options → [pick one] → signed quote → Stripe
//
// A hosted Stripe Checkout Session cannot compute shipping from an address —
// only Stripe's embedded integration can. So the address is collected HERE, we
// ask Printful what it actually costs to ship this cart to that address, and the
// chosen option is frozen into a server-signed quote. Checkout then creates a
// Session with that one fixed shipping amount and address collection turned off,
// because letting the buyer change the address on Stripe's page would silently
// invalidate the rate we bought.
//
// Nothing on this screen is trusted. Prices render from what the server returned
// and are sent back to no one; the quote token is opaque and we never look
// inside it. If this file computed a total, that total would be decoration.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Btn } from "../components/atoms.js";
import { Icon } from "../components/Icon.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorCode, errorMessage, money } from "../lib/api.js";
import {
  addToCart,
  cartItems,
  readCart,
  removeFromCart,
  setQuantity,
  type CartLine,
} from "../lib/cart.js";
import type { StoreAddressInput, StoreShippingRateDTO } from "@sd/shared";

const BLANK: StoreAddressInput = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  phone: "",
};

/** Kept so a shopper who bounces off Stripe's page and comes back doesn't retype
 *  their address. Deliberately NOT the email-plus-address of someone who never
 *  bought anything sitting on our server — this is their own browser. */
const ADDRESS_KEY = "sd_store_ship_to";

function loadAddress(): { address: StoreAddressInput; email: string } {
  try {
    const raw = window.localStorage.getItem(ADDRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { address?: StoreAddressInput; email?: string };
      return { address: { ...BLANK, ...(parsed.address ?? {}) }, email: parsed.email ?? "" };
    }
  } catch {
    /* fall through to blank */
  }
  return { address: BLANK, email: "" };
}

function saveAddress(address: StoreAddressInput, email: string): void {
  try {
    window.localStorage.setItem(ADDRESS_KEY, JSON.stringify({ address, email }));
  } catch {
    /* storage disabled; the form still works for this page view */
  }
}

function Line({
  line,
  onChange,
  onRemove,
}: {
  line: CartLine;
  onChange: (qty: number) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="sd-crow" style={{ alignItems: "flex-start", gap: 12 }}>
      {line.imageUrl ? (
        <img
          src={line.imageUrl}
          alt=""
          width={56}
          height={56}
          style={{ borderRadius: "var(--r-sm)", objectFit: "cover", flex: "0 0 auto", background: "var(--bg)" }}
        />
      ) : (
        <div
          style={{ width: 56, height: 56, borderRadius: "var(--r-sm)", background: "var(--bg)", flex: "0 0 auto" }}
        />
      )}
      <div className="sd-cmain" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{line.title}</div>
        <div className="sd-meta">{line.variantLabel}</div>
        <div className="sd-row" style={{ gap: 8, marginTop: 6 }}>
          <label className="sd-label" htmlFor={`qty-${line.variantId}`}>
            {t("storeQty")}
          </label>
          <input
            id={`qty-${line.variantId}`}
            className="sd-input"
            type="number"
            min={1}
            max={25}
            value={line.quantity}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ width: 72, padding: "4px 8px" }}
          />
          <button className="sd-link" type="button" onClick={onRemove} style={{ fontSize: 13 }}>
            {t("storeRemove")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Take the hand-off from the storefront's JavaScript-free "Add to cart" form.
 *
 * That form is a plain `GET /cart?add=<variantId>&p=<slug>` — the product page
 * ships no bundle, so it cannot write to localStorage itself. It sends ids only,
 * never a price or a title, so this resolves them against the API rather than
 * trusting the URL: a hand-edited `add` param can at worst name a variant that
 * doesn't exist, and gets nothing.
 *
 * The params are stripped afterwards so a refresh, a back-button or a copied URL
 * doesn't silently add the item again.
 */
function useAddFromQuery(onAdded: (lines: CartLine[]) => void) {
  const [params, setParams] = useSearchParams();
  const variantId = params.get("add");
  const slug = params.get("p");

  useEffect(() => {
    if (!variantId || !slug) return;
    let cancelled = false;
    void (async () => {
      try {
        const { product } = await api.product(slug);
        const variant = product.variants.find((v) => v.id === variantId);
        if (!cancelled && variant && variant.inStock) {
          onAdded(
            addToCart({
              slug: product.slug,
              variantId: variant.id,
              quantity: 1,
              title: product.title,
              variantLabel: variant.label,
              imageUrl: variant.imageUrl ?? product.imageUrl,
            }),
          );
        }
      } catch {
        // A stale link resolves to "nothing was added" rather than an error
        // screen — the cart below is still perfectly usable.
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(params);
          next.delete("add");
          next.delete("p");
          setParams(next, { replace: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Keyed on the two params only: re-running when `params` identity changes
    // would re-add the item on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantId, slug]);
}

function CartBody() {
  const { t } = useI18n();
  const [lines, setLines] = useState<CartLine[]>(() => readCart());
  useAddFromQuery(setLines);
  const initial = useMemo(loadAddress, []);
  const [address, setAddress] = useState<StoreAddressInput>(initial.address);
  const [email, setEmail] = useState(initial.email);

  const [rates, setRates] = useState<StoreShippingRateDTO[] | null>(null);
  const [subtotalCents, setSubtotalCents] = useState(0);
  const [rateId, setRateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Any edit to the cart or the address invalidates a quote we already have —
  // the price was for THAT cart to THAT address. Clearing the options is what
  // stops someone pricing a t-shirt and checking out with a hoodie.
  useEffect(() => {
    setRates(null);
    setRateId(null);
  }, [lines, address.line1, address.city, address.state, address.postalCode, address.country]);

  const set = (key: keyof StoreAddressInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddress((a) => ({ ...a, [key]: e.target.value }));

  const getRates = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      saveAddress(address, email);
      const res = await api.shippingRates(cartItems(lines), address);
      setRates(res.rates);
      setSubtotalCents(res.subtotalCents);
      setRateId(res.rates[0]?.id ?? null);
    } catch (err) {
      setError(errorMessage(err, "We couldn't work out shipping to that address."));
    } finally {
      setBusy(false);
    }
  };

  const checkout = async () => {
    if (!rateId) return;
    setError(null);
    setBusy(true);
    try {
      // Quote and checkout are back to back on purpose: the quote's thirty
      // minutes are for a slow card form, not for a slow decision, and minting
      // it at the moment of purchase means the shopper pays what they just saw.
      const quote = await api.quote(cartItems(lines), address, email, rateId);
      const { checkoutUrl } = await api.checkout(quote.token);
      // Leaving the SPA entirely. The cart is deliberately NOT cleared here —
      // a shopper who backs out of Stripe must come back to a full cart, and
      // the order they may or may not have paid for is the server's business,
      // not this browser's.
      window.location.href = checkoutUrl;
    } catch (err) {
      const code = errorCode(err);
      if (code === "quote_expired" || code === "quote_invalid") {
        // Re-price rather than fail: the buyer sees the fresh total and presses
        // again. Never silently charge a number they weren't shown.
        setRates(null);
        setRateId(null);
        setError("Prices moved while you were away — please check the total and try again.");
      } else {
        setError(errorMessage(err, "We couldn't start checkout. Please try again in a moment."));
      }
      setBusy(false);
    }
  };

  const chosen = rates?.find((r) => r.id === rateId) ?? null;
  const totalCents = subtotalCents + (chosen?.amountCents ?? 0);

  if (lines.length === 0) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <p className="sd-lead">{t("storeCartEmpty")}</p>
        <p style={{ marginTop: 12 }}>
          <a className="sd-link" href="/">
            {t("storeKeepShopping")}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="sd-card" style={{ padding: 4 }}>
        {lines.map((line) => (
          <Line
            key={line.variantId}
            line={line}
            onChange={(qty) => setLines(setQuantity(line.variantId, qty))}
            onRemove={() => setLines(removeFromCart(line.variantId))}
          />
        ))}
      </div>

      <form onSubmit={getRates} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="sd-h2">{t("storeWhereTo")}</div>

        <label className="sd-label" htmlFor="ship-email">{t("storeEmail")}</label>
        <input
          id="ship-email"
          className="sd-input"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="sd-label" htmlFor="ship-name">{t("storeFullName")}</label>
        <input id="ship-name" className="sd-input" autoComplete="name" required value={address.name} onChange={set("name")} />

        <label className="sd-label" htmlFor="ship-line1">{t("storeAddress1")}</label>
        <input id="ship-line1" className="sd-input" autoComplete="address-line1" required value={address.line1} onChange={set("line1")} />

        <label className="sd-label" htmlFor="ship-line2">{t("storeAddress2")}</label>
        <input id="ship-line2" className="sd-input" autoComplete="address-line2" value={address.line2 ?? ""} onChange={set("line2")} />

        <div className="sd-row" style={{ gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <label className="sd-label" htmlFor="ship-city">{t("storeCity")}</label>
            <input id="ship-city" className="sd-input" autoComplete="address-level2" required value={address.city} onChange={set("city")} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="sd-label" htmlFor="ship-state">{t("storeState")}</label>
            <input id="ship-state" className="sd-input" autoComplete="address-level1" required maxLength={2} value={address.state} onChange={set("state")} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label className="sd-label" htmlFor="ship-zip">{t("storePostalCode")}</label>
            <input id="ship-zip" className="sd-input" autoComplete="postal-code" required value={address.postalCode} onChange={set("postalCode")} />
          </div>
        </div>

        <label className="sd-label" htmlFor="ship-phone">{t("storePhone")}</label>
        <input id="ship-phone" className="sd-input" autoComplete="tel" value={address.phone ?? ""} onChange={set("phone")} />

        {!rates && (
          <Btn kind="primary" block disabled={busy} type="submit">
            {t("storeGetShipping")}
          </Btn>
        )}
      </form>

      {rates && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sd-h2">{t("storeChooseShipping")}</div>
          {rates.map((rate) => (
            <label key={rate.id} className="sd-fieldcard sd-row" style={{ gap: 10, cursor: "pointer" }}>
              <input
                type="radio"
                name="rate"
                checked={rateId === rate.id}
                onChange={() => setRateId(rate.id)}
              />
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 700 }}>{rate.label}</span>
                {rate.deliveryEstimate && <span className="sd-meta"> · {rate.deliveryEstimate}</span>}
              </span>
              <span style={{ fontWeight: 700 }}>{money(rate.amountCents)}</span>
            </label>
          ))}

          <div className="sd-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="sd-row" style={{ justifyContent: "space-between" }}>
              <span>{t("storeSubtotal")}</span>
              <span>{money(subtotalCents)}</span>
            </div>
            <div className="sd-row" style={{ justifyContent: "space-between" }}>
              <span>{t("storeShipping")}</span>
              <span>{money(chosen?.amountCents ?? 0)}</span>
            </div>
            <div className="sd-divider" />
            <div className="sd-row" style={{ justifyContent: "space-between", fontWeight: 800 }}>
              <span>{t("storeTotal")}</span>
              <span>{money(totalCents)}</span>
            </div>
          </div>

          <Btn kind="primary" block disabled={busy || !rateId} onClick={() => void checkout()}>
            {t("storeCheckout")}
          </Btn>
          <div className="sd-row" style={{ gap: 7, color: "var(--ink-3)", fontSize: 12.5, fontWeight: 600 }}>
            <Icon name="lock" size={14} stroke={2} style={{ flex: "0 0 auto" }} />
            <span>{t("storeCheckoutNote")}</span>
          </div>
        </div>
      )}

      {error && (
        <p className="sd-lead" style={{ color: "var(--warn)", fontSize: 13.5 }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Cart() {
  const { t } = useI18n();
  const desktop = useIsDesktop();

  if (desktop) {
    return (
      <DesktopShell active="cart" title={t("storeCart")}>
        <CartBody />
        <SiteFooter />
      </DesktopShell>
    );
  }

  return (
    <AppShell bottomNav={<BottomNav active="cart" />}>
      <ScreenHeader title={t("storeCart")} />
      {/* .sd-scroll carries the min-height:0 that lets this column actually
          scroll inside the 100dvh shell — content placed directly in AppShell
          is clipped instead. */}
      <div className="sd-scroll">
        <CartBody />
      </div>
    </AppShell>
  );
}
