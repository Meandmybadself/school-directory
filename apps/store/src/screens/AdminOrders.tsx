// Admin: orders.
//
// The one screen here that is not convenience. `fulfillment_failed` means a
// family was CHARGED and nothing was printed — the retry loop has already spent
// its budget, Slack has already said so, and this is where a person picks it up.
// So the failed ones sort to the top and carry Printful's actual error text,
// which is deliberately withheld from the buyer's own page (it names variant ids
// and says nothing they can act on).
//
// Unfiltered, the list excludes `abandoned` — an unpaid checkout is kept, but
// burying six real orders under forty abandoned carts is how a stuck one goes
// unnoticed.
//
// English-only by convention, like the sibling apps' admin screens.

import { useCallback, useEffect, useState } from "react";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Btn, Tag } from "../components/atoms.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage, money } from "../lib/api.js";
import type { StoreOrderDTO } from "@sd/shared";

const FILTERS = ["needs help", "all", "paid", "submitted", "shipped", "abandoned"] as const;
type Filter = (typeof FILTERS)[number];

function tone(status: StoreOrderDTO["status"]): "blue" | "orange" | "line" | "" {
  if (status === "shipped") return "blue";
  if (status === "fulfillment_failed") return "orange";
  if (status === "abandoned" || status === "awaiting_payment") return "line";
  return "";
}

function Row({ order, onChange }: { order: StoreOrderDTO; onChange: (next: StoreOrderDTO) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.retryOrder(order.id);
      if (res.order) onChange(res.order);
    } catch (err) {
      setError(errorMessage(err, "Couldn't retry that order."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sd-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="sd-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{order.shippingAddress.name}</div>
          <div className="sd-meta">
            {order.email} · {(order.paidAt ?? order.createdAt).slice(0, 16).replace("T", " ")}
          </div>
        </div>
        <Tag tone={tone(order.status)}>{order.status.replace(/_/g, " ")}</Tag>
      </div>

      <div>
        {order.lines.map((line) => (
          <div key={line.variantId} className="sd-row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span>
              {line.title} — {line.variantLabel} × {line.quantity}
            </span>
            <span>{money(line.unitPriceCents * line.quantity, order.currency)}</span>
          </div>
        ))}
      </div>

      <div className="sd-row" style={{ justifyContent: "space-between", fontWeight: 700 }}>
        <span>
          {order.shippingLabel} · {money(order.shippingCents, order.currency)}
        </span>
        <span>{money(order.totalCents, order.currency)}</span>
      </div>

      <div className="sd-meta">
        {order.shippingAddress.line1}
        {order.shippingAddress.line2 ? `, ${order.shippingAddress.line2}` : ""}, {order.shippingAddress.city}{" "}
        {order.shippingAddress.state} {order.shippingAddress.postalCode}
      </div>

      {order.printfulOrderId && <div className="sd-meta">Printful #{order.printfulOrderId}</div>}
      {order.trackingNumber && (
        <div className="sd-meta">
          {order.carrier ? `${order.carrier} · ` : ""}
          {order.trackingNumber}
        </div>
      )}

      {order.lastSubmitError && (
        <div className="sd-meta" style={{ color: "var(--warn)" }}>
          Printful said: {order.lastSubmitError} ({order.submitAttempts} attempts)
        </div>
      )}

      {order.status === "fulfillment_failed" && (
        <div className="sd-row" style={{ gap: 8 }}>
          <Btn kind="primary" sm disabled={busy} onClick={() => void retry()}>
            Retry submission
          </Btn>
          {error && <span className="sd-meta" style={{ color: "var(--warn)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

function Body() {
  const [filter, setFilter] = useState<Filter>("needs help");
  const [orders, setOrders] = useState<StoreOrderDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: Filter) => {
    setOrders(null);
    setError(null);
    try {
      // "needs help" and "all" are both the unfiltered request; the first just
      // narrows what it shows. Asking the server for `fulfillment_failed` alone
      // would hide the `paid` orders that are stuck mid-retry, which is the
      // other half of "needs help".
      const res = await api.adminOrders(next === "all" || next === "needs help" ? undefined : next);
      setOrders(
        next === "needs help"
          ? res.orders.filter((o) => o.status === "fulfillment_failed" || o.submitAttempts > 1)
          : res.orders,
      );
    } catch (err) {
      setError(errorMessage(err, "Couldn't load orders."));
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  return (
    <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="sd-row" style={{ gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`sd-btn sd-btn-sm ${filter === f ? "sd-btn-primary" : "sd-btn-ghost"}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="sd-lead" style={{ color: "var(--warn)", fontSize: 13.5 }}>{error}</p>}
      {!orders && !error && <div className="sd-boot"><div className="sd-spinner" /></div>}
      {orders?.length === 0 && (
        <p className="sd-lead">
          {filter === "needs help" ? "Nothing needs attention." : "No orders here."}
        </p>
      )}
      {orders?.map((order) => (
        <Row
          key={order.id}
          order={order}
          onChange={(next) => setOrders((list) => (list ?? []).map((o) => (o.id === next.id ? next : o)))}
        />
      ))}
    </div>
  );
}

export function AdminOrders() {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <DesktopShell active="admin" title="Orders">
        <Body />
        <SiteFooter />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Orders" />
      <div className="sd-scroll">
        <Body />
      </div>
    </AppShell>
  );
}
