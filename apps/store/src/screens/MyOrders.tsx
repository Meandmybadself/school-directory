// A signed-in buyer's own orders.
//
// Only orders placed WHILE SIGNED IN appear here, and that is deliberate rather
// than a gap: a guest checkout has no `user_id`, and matching one to an account
// by email afterwards would let anyone who signs up with an address see what
// that address once bought. A guest's way back is the status link in their
// confirmation email, which is derived from the order id and never expires.

import { useEffect, useState } from "react";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Tag } from "../components/atoms.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useI18n } from "../i18n/index.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, money } from "../lib/api.js";
import type { StoreOrderDTO } from "@sd/shared";

/** The buyer-facing reading of an internal status. Kept in step with
 *  `publicStatus` in lib/storeOrder.ts on the server — the difference is that
 *  this screen is behind a session, so it may also say "we haven't taken your
 *  money" about an abandoned checkout, which the token page never needs to. */
function statusTag(t: ReturnType<typeof useI18n>["t"], status: StoreOrderDTO["status"]) {
  switch (status) {
    case "shipped":
      return <Tag tone="blue">{t("storeOrderShipped")}</Tag>;
    case "fulfillment_failed":
      return <Tag tone="orange">{t("storeOrderProblem")}</Tag>;
    case "awaiting_payment":
    case "abandoned":
      return <Tag tone="line">—</Tag>;
    default:
      return <Tag>{t("storeOrderProcessing")}</Tag>;
  }
}

function Body() {
  const { t } = useI18n();
  const [orders, setOrders] = useState<StoreOrderDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .myOrders()
      .then((res) => setOrders(res.orders))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className="sd-lead" style={{ padding: 20 }}>{t("storeOrderNotFound")}</p>;
  if (!orders) return <div className="sd-boot"><div className="sd-spinner" /></div>;
  if (orders.length === 0) {
    return (
      <div style={{ padding: "24px 20px" }}>
        <p className="sd-lead">{t("storeCartEmpty")}</p>
        <p style={{ marginTop: 12 }}>
          <a className="sd-link" href="/">{t("storeKeepShopping")}</a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
      {orders.map((order) => (
        <div key={order.id} className="sd-card" style={{ padding: 14 }}>
          <div className="sd-row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="sd-meta">
              {t("storePlaced")} {(order.paidAt ?? order.createdAt).slice(0, 10)}
            </span>
            {statusTag(t, order.status)}
          </div>
          <div style={{ marginTop: 8 }}>
            {order.lines.map((line) => (
              <div key={line.variantId} className="sd-row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span>
                  {line.title} — {line.variantLabel} × {line.quantity}
                </span>
                <span>{money(line.unitPriceCents * line.quantity, order.currency)}</span>
              </div>
            ))}
          </div>
          <div className="sd-divider" style={{ margin: "8px 0" }} />
          <div className="sd-row" style={{ justifyContent: "space-between", fontWeight: 800 }}>
            <span>{t("storeTotal")}</span>
            <span>{money(order.totalCents, order.currency)}</span>
          </div>
          {order.trackingUrl && (
            <p style={{ marginTop: 8 }}>
              <a className="sd-link" href={order.trackingUrl} target="_blank" rel="noreferrer">
                {t("storeTracking")}
                {order.trackingNumber ? ` · ${order.trackingNumber}` : ""}
              </a>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function MyOrders() {
  const { t } = useI18n();
  const desktop = useIsDesktop();

  if (desktop) {
    return (
      <DesktopShell active="store" title={t("storeOrderTitle")}>
        <Body />
        <SiteFooter />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="store" />}>
      <ScreenHeader title={t("storeOrderTitle")} />
      <div className="sd-scroll">
        <Body />
      </div>
    </AppShell>
  );
}
