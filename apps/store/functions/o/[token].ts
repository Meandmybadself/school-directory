// GET /o/:token — one order, for whoever holds the link.
//
// This is Stripe's success_url and the link in the confirmation email, and it is
// the ONLY way a guest — who by definition has no account — gets back to their
// order. Holding the token is the authorization, invariant 15's rule.
//
// Three things follow from that and none are optional:
//
//   htmlPrivate(), always. The shared cache is keyed on the URL, so a cacheable
//   response would let the edge hand the next reader of that URL somebody else's
//   order. It also keeps the token out of referrers and out of search indexes.
//
//   No hreflang alternates and no canonical worth advertising. This page must
//   never be indexed; `noindex` here is belt to htmlPrivate's x-robots-tag.
//
//   Everything shown comes from `orderStatusOf`, which is built field by field
//   and carries no street address, no Stripe or Printful id, no internal status
//   and no operational error text. A forwarded link should not hand a stranger
//   someone's doorstep.

import type { PublicStoreOrderDTO } from "@sd/shared";
import { header, footer } from "../_lib/chrome.js";
import { resolveLocale } from "../_lib/locale.js";
import { apiJson, escapeHtml, htmlPrivate, money, shell, translator, type PagesEnv } from "../_lib/page.js";
import { STORE_CSS } from "../_lib/styles.js";

const SCHOOL = "Eisenhower PTO";

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env, params }) => {
  const url = new URL(request.url);
  const { locale } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);
  const token = String(params.token ?? "");

  const data = await apiJson<{ order: PublicStoreOrderDTO }>(
    env,
    `/store-public/orders/${encodeURIComponent(token)}`,
  );

  if (!data?.order) {
    return htmlPrivate(
      shell({
        title: `${t("storeOrderTitle")} — ${SCHOOL}`,
        description: "",
        canonical: url.origin,
        locale,
        css: STORE_CSS,
        noindex: true,
        body: `    <div class="st-wrap">
${header(t, SCHOOL)}
      <div class="st-empty">
        <p>${escapeHtml(t("storeOrderNotFound"))}</p>
        <p><a href="/">${escapeHtml(t("storeKeepShopping"))}</a></p>
      </div>
${footer("/", locale)}
    </div>`,
      }),
      404,
    );
  }

  const order = data.order;
  const headline =
    order.status === "shipped"
      ? t("storeOrderShipped")
      : order.status === "problem"
        ? t("storeOrderProblem")
        : t("storeOrderProcessing");

  const lines = order.lines
    .map(
      (l) =>
        `        <tr><td>${escapeHtml(l.title)} — ${escapeHtml(l.variantLabel)} × ${l.quantity}</td>` +
        `<td>${escapeHtml(money(l.unitPriceCents * l.quantity, order.currency))}</td></tr>`,
    )
    .join("\n");

  const tracking = order.trackingUrl
    ? `      <p><a href="${escapeHtml(order.trackingUrl)}">${escapeHtml(t("storeTracking"))}${
        order.trackingNumber ? ` · ${escapeHtml(order.trackingNumber)}` : ""
      }</a></p>`
    : order.trackingNumber
      ? `      <p>${escapeHtml(t("storeTracking"))}: ${escapeHtml(order.trackingNumber)}</p>`
      : "";

  const body = `    <div class="st-wrap">
${header(t, SCHOOL)}
      <h1 class="st-h1">${escapeHtml(t("storeOrderTitle"))}</h1>
      <div class="st-status">
        <h2>${escapeHtml(headline)}</h2>
        ${order.status === "problem" ? `<p>${escapeHtml(t("storeOrderProblemNote"))}</p>` : ""}
        ${order.status === "processing" ? `<p>${escapeHtml(t("storeMadeToOrder"))}</p>` : ""}
      </div>
${tracking}
      <table class="st-lines">
${lines}
        <tr><td>${escapeHtml(order.shippingLabel)}</td><td>${escapeHtml(
          money(order.shippingCents, order.currency),
        )}</td></tr>
        <tr><td>${escapeHtml(t("storeTotal"))}</td><td>${escapeHtml(
          money(order.totalCents, order.currency),
        )}</td></tr>
      </table>
      <p class="st-desc" style="margin-top:18px;font-size:13.5px;color:var(--ink-3)">
        ${escapeHtml(t("storeShipTo"))}: ${escapeHtml(order.shipTo.name)}, ${escapeHtml(
          order.shipTo.city,
        )} ${escapeHtml(order.shipTo.state)} ${escapeHtml(order.shipTo.postalCode)}
      </p>
${footer("/", locale)}
    </div>`;

  return htmlPrivate(
    shell({
      title: `${t("storeOrderTitle")} — ${SCHOOL}`,
      description: "",
      canonical: url.origin,
      locale,
      css: STORE_CSS,
      noindex: true,
      body,
    }),
  );
};
