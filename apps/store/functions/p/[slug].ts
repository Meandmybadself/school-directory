// GET /p/:slug — one product.
//
// The page a link preview is actually built from, and the one a shopper lands on
// from a share. Indexed, translated, and JavaScript-free.
//
// "Add to cart" is a plain <form method="get" action="/cart">. That is not a
// nostalgic choice: this page ships no bundle, and a button that needed one
// would mean either loading the SPA here (undoing the reason these pages are
// server-rendered) or an add-to-cart that silently does nothing with JS off. The
// form navigates to /cart?add=<variantId>&p=<slug>, and the cart screen resolves
// those against the API and drops them from the URL.
//
// Note what the form carries: OUR variant id and OUR slug. No price — the cart
// re-reads every amount server-side — and no Printful id, which never leaves the
// server at all (invariant 26).

import type { PublicStoreProductDTO } from "@sd/shared";
import { header, footer } from "../_lib/chrome.js";
import { resolveLocale, langCookie } from "../_lib/locale.js";
import { apiJson, escapeHtml, html, money, shell, translator, type PagesEnv } from "../_lib/page.js";
import { STORE_CSS } from "../_lib/styles.js";

const SCHOOL = "Eisenhower PTO";

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env, params }) => {
  const url = new URL(request.url);
  const { locale, explicit } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);
  const slug = String(params.slug ?? "");

  const data = await apiJson<{ product: PublicStoreProductDTO }>(
    env,
    `/store-public/products/${encodeURIComponent(slug)}`,
  );

  if (!data?.product) {
    // An unpublished product is filtered in SQL, so a guessed slug lands here
    // and reveals nothing about what might be in preparation.
    return html(
      shell({
        title: `${t("storeTitle")} — ${SCHOOL}`,
        description: t("storeEmpty"),
        canonical: `${url.origin}/p/${encodeURIComponent(slug)}`,
        locale,
        css: STORE_CSS,
        noindex: true,
        body: `    <div class="st-wrap">
${header(t, SCHOOL)}
      <div class="st-empty">
        <p>${escapeHtml(t("storeEmpty"))}</p>
        <p><a href="/">${escapeHtml(t("storeKeepShopping"))}</a></p>
      </div>
${footer(t, `/p/${slug}`, locale)}
    </div>`,
      }),
      404,
    );
  }

  const product = data.product;
  const buyable = product.variants.filter((v) => v.inStock);
  const path = `/p/${encodeURIComponent(product.slug)}`;

  const options = buyable
    .map(
      (v) =>
        `            <option value="${escapeHtml(v.id)}">${escapeHtml(v.label)} — ${escapeHtml(
          money(v.priceCents),
        )}</option>`,
    )
    .join("\n");

  const buy =
    buyable.length === 0
      ? `          <p class="st-desc"><strong>${escapeHtml(t("storeSoldOut"))}</strong></p>`
      : `          <form method="get" action="/cart">
            <input type="hidden" name="p" value="${escapeHtml(product.slug)}" />
            <label class="st-label" for="variant">${escapeHtml(t("storeChooseOption"))}</label>
            <select class="st-select" id="variant" name="add">
${options}
            </select>
            <button class="st-btn" type="submit">${escapeHtml(t("storeAddToCart"))}</button>
          </form>`;

  const body = `    <div class="st-wrap">
${header(t, SCHOOL)}
      <div class="st-detail">
        <div>
          ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title)}" width="700" height="700" />` : ""}
        </div>
        <div>
          <h1 class="st-h1">${escapeHtml(product.title)}</h1>
          <div class="st-price">${escapeHtml(
            t("storeFrom").replace("{price}", money(product.fromPriceCents)),
          )}</div>
          ${product.blurb ? `<p class="st-desc">${escapeHtml(product.blurb)}</p>` : ""}
${buy}
          <p class="st-desc" style="margin-top:18px;font-size:13.5px;color:var(--ink-3)">${escapeHtml(
            t("storeMadeToOrder"),
          )}</p>
        </div>
      </div>
${footer(t, path, locale)}
    </div>`;

  return html(
    shell({
      // Product copy is admin-entered and never translated (invariant 6); the
      // chrome around it is.
      title: `${product.title} — ${SCHOOL}`,
      description: product.blurb ?? t("storeLead"),
      canonical: `${url.origin}${path}`,
      locale,
      css: STORE_CSS,
      image: product.imageUrl,
      alternatesFor: `${url.origin}${path}`,
      body,
    }),
    200,
    explicit ? langCookie(locale) : undefined,
  );
};
