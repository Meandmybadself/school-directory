// GET / — the storefront.
//
// The one page in this app most likely to be linked from a class Facebook group
// or a text message, so it is server-rendered with full OG tags and no bundle.
// It is also INDEXED: see functions/_lib/page.ts on what that obliges.
//
// Every failure mode resolves to an empty shop rather than an error, the same
// posture apps/home takes toward its events block. An API blip must not make the
// store look broken to a stranger who has never seen it working.

import type { PublicStoreProductDTO } from "@sd/shared";
import { header, footer } from "./_lib/chrome.js";
import { resolveLocale, langCookie } from "./_lib/locale.js";
import { apiJson, escapeHtml, html, money, shell, translator, type PagesEnv } from "./_lib/page.js";
import { STORE_CSS } from "./_lib/styles.js";

const SCHOOL = "Eisenhower PTO";

function card(product: PublicStoreProductDTO, fromLabel: string): string {
  const href = `/p/${encodeURIComponent(product.slug)}`;
  return `      <a class="st-card" href="${escapeHtml(href)}">
        ${product.imageUrl ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" width="400" height="400" />` : ""}
        <div class="st-card-body">
          <div class="st-card-title">${escapeHtml(product.title)}</div>
          <div class="st-card-price">${escapeHtml(fromLabel)}</div>
        </div>
      </a>`;
}

export const onRequestGet: PagesFunction<PagesEnv> = async ({ request, env }) => {
  const url = new URL(request.url);
  const { locale, explicit } = resolveLocale(url, request);
  const t = translator(locale, SCHOOL);

  const data = await apiJson<{ products: PublicStoreProductDTO[] }>(env, "/store-public/products");
  const products = data?.products ?? [];

  const body = `    <div class="st-wrap">
${header(t, SCHOOL, locale)}
      <h1 class="st-h1">${escapeHtml(t("storeTitle"))}</h1>
      <p class="st-lead">${escapeHtml(t("storeLead"))}</p>
${
    products.length === 0
      ? `      <div class="st-empty">${escapeHtml(t("storeEmpty"))}</div>`
      : `      <div class="st-grid">
${products.map((p) => card(p, t("storeFrom").replace("{price}", money(p.fromPriceCents)))).join("\n")}
      </div>`
  }
${footer(t, "/", locale)}
    </div>`;

  return html(
    shell({
      title: `${t("storeTitle")} — ${SCHOOL}`,
      description: t("storeLead"),
      canonical: `${url.origin}/`,
      locale,
      css: STORE_CSS,
      image: products[0]?.imageUrl ?? null,
      alternatesFor: `${url.origin}/`,
      body,
    }),
    200,
    // Remembered only when they SAID so. A detected language never becomes a
    // stored preference — see _lib/locale.ts.
    explicit ? langCookie(locale) : undefined,
  );
};
