// The store's catalog: a D1 overlay on Printful's synced products, and the
// server-side pricing every cart goes through.
//
// Printful owns the design, the mockups and the wholesale cost. This file owns
// what the PTO decides — whether an item is for sale, what it is called, what it
// says, what it costs, and where it sorts — plus the one rule that matters most:
// a price is READ here, never received. Nothing in a request body may name an
// amount of money.

import type {
  PublicStoreProductDTO,
  PublicStoreVariantDTO,
  StoreCartItemInput,
  StoreLineDTO,
  StoreProductDTO,
  StoreProductPatchBody,
  StoreVariantDTO,
} from "@sd/shared";
import { slugifyTitle } from "@sd/shared";
import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { getSyncProduct } from "./printful.js";
import { nowIso } from "./time.js";

export class StoreError extends Error {}

const MAX_TITLE = 120;
const MAX_BLURB = 2000;
/** A school store selling a $2,000 item is a typo, not a product. */
const MAX_PRICE_CENTS = 200_000;
const MAX_QUANTITY = 25;
/** One cart, not a wholesale order. Also bounds the Printful rate call. */
const MAX_CART_LINES = 20;

// ── Rows ────────────────────────────────────────────────────────────────────

export interface StoreProductRow {
  id: string;
  printful_sync_product_id: string;
  slug: string;
  printful_title: string;
  title_override: string | null;
  blurb: string | null;
  image_url: string | null;
  sort_order: number;
  published_at: string | null;
  variants_json: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

/** A cached variant as it is stored inside `variants_json`.
 *
 *  Both Printful ids live here and nowhere else. `id` is ours and is what a URL,
 *  a cart line and an order line key on, which is what makes the eventual move
 *  from one Printful store to the PTO's own a re-point rather than a migration
 *  (see migration 0022's header). */
export interface StoredVariant {
  id: string;
  printfulSyncVariantId: string;
  printfulCatalogVariantId: string;
  label: string;
  imageUrl: string | null;
  inStock: boolean;
  priceCents: number;
}

function parseVariants(row: StoreProductRow): StoredVariant[] {
  try {
    const parsed = JSON.parse(row.variants_json) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredVariant[]) : [];
  } catch {
    // A corrupt cache means "no variants to sell", never a 500 on the storefront.
    console.error(`[store] product ${row.id} has unparseable variants_json`);
    return [];
  }
}

const SELECT_PRODUCT = `SELECT id, printful_sync_product_id, slug, printful_title, title_override,
         blurb, image_url, sort_order, published_at, variants_json, synced_at,
         created_at, updated_at
    FROM store_product`;

// ── Projections ─────────────────────────────────────────────────────────────

export function productTitle(row: StoreProductRow): string {
  return row.title_override?.trim() || row.printful_title;
}

function adminVariant(v: StoredVariant): StoreVariantDTO {
  return { id: v.id, label: v.label, imageUrl: v.imageUrl, inStock: v.inStock, priceCents: v.priceCents };
}

export function productDto(row: StoreProductRow): StoreProductDTO {
  return {
    id: row.id,
    printfulSyncProductId: row.printful_sync_product_id,
    slug: row.slug,
    title: productTitle(row),
    printfulTitle: row.printful_title,
    titleOverride: row.title_override,
    blurb: row.blurb,
    imageUrl: row.image_url,
    published: row.published_at !== null,
    sortOrder: row.sort_order,
    variants: parseVariants(row).map(adminVariant),
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

/**
 * THE storefront projection — the companion to `publicEventOf`, `publicSheetOf`
 * and `issuePageOf`.
 *
 * Built field by field, never by spreading a row or a StoreProductDTO, for the
 * reason invariant 12 states: a column added to `store_product` must not reach
 * an anonymous reader until somebody edits this function on purpose. Two
 * withholdings are deliberate rather than incidental. Both Printful ids stay
 * server-side — a shopper addresses a product by slug and a variant by our own
 * id, so nothing public survives the day this catalog is re-pointed at the PTO's
 * Printful store. And `sortOrder`/`syncedAt`/`published` are merchandising
 * bookkeeping that says how the shop is run, not what is in it.
 *
 * Wholesale cost and margin are absent because they have no column anywhere in
 * this schema — there is nothing here to leak, which is a better guarantee than
 * remembering to omit it.
 */
export function publicProductOf(row: StoreProductRow): PublicStoreProductDTO {
  const variants: PublicStoreVariantDTO[] = parseVariants(row).map((v) => ({
    id: v.id,
    label: v.label,
    imageUrl: v.imageUrl,
    inStock: v.inStock,
    priceCents: v.priceCents,
  }));
  const prices = variants.filter((v) => v.inStock).map((v) => v.priceCents);
  return {
    slug: row.slug,
    title: productTitle(row),
    blurb: row.blurb,
    imageUrl: row.image_url,
    variants,
    // Computed here rather than in each caller so a tile, a product page and an
    // SSR meta tag can't disagree about what "from" means.
    fromPriceCents: prices.length ? Math.min(...prices) : 0,
  };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listProducts(env: Env, publishedOnly: boolean): Promise<StoreProductRow[]> {
  const sql = publishedOnly
    ? `${SELECT_PRODUCT} WHERE published_at IS NOT NULL ORDER BY sort_order ASC, created_at ASC`
    : `${SELECT_PRODUCT} ORDER BY sort_order ASC, created_at ASC`;
  const res = await env.DB.prepare(sql).all<StoreProductRow>();
  return res.results;
}

export async function productBySlug(
  env: Env,
  slug: string,
  publishedOnly: boolean,
): Promise<StoreProductRow | null> {
  // The published filter is in SQL, not applied afterwards, for the same reason
  // invariant 15 gives for `status = 'sent'`: a guessed draft slug must reveal
  // nothing, including how long the lookup took.
  const sql = publishedOnly
    ? `${SELECT_PRODUCT} WHERE slug = ? AND published_at IS NOT NULL`
    : `${SELECT_PRODUCT} WHERE slug = ?`;
  return env.DB.prepare(sql).bind(slug).first<StoreProductRow>();
}

export async function productById(env: Env, id: string): Promise<StoreProductRow | null> {
  return env.DB.prepare(`${SELECT_PRODUCT} WHERE id = ?`).bind(id).first<StoreProductRow>();
}

// ── Slugs ───────────────────────────────────────────────────────────────────

/** Append -2, -3, … until free, mirroring the newsletter's and volunteers'
 *  `uniqueSlug`. Two colourways of the same tee is ordinary. */
async function uniqueProductSlug(env: Env, base: string): Promise<string> {
  const root = base || "item";
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const taken = await env.DB.prepare("SELECT 1 AS x FROM store_product WHERE slug = ?")
      .bind(candidate)
      .first<{ x: number }>();
    if (!taken) return candidate;
  }
  return `${root}-${ulid().slice(-6).toLowerCase()}`;
}

// ── Import and re-sync ──────────────────────────────────────────────────────

/**
 * Merge a fresh Printful variant list into whatever we already hold.
 *
 * Two things must survive a re-sync, and both are keyed on Printful's sync
 * variant id: OUR variant id, because carts, order lines and any open browser
 * tab reference it; and the admin's PRICE, because Printful's suggested retail
 * is only ever a starting point and re-syncing must not quietly undo a price
 * someone set on purpose.
 *
 * A variant Printful no longer returns is dropped rather than kept as
 * out-of-stock: it is gone upstream, and leaving it visible would let someone
 * buy something that fails at submission after the card is charged.
 */
function mergeVariants(
  existing: StoredVariant[],
  fresh: {
    syncVariantId: string;
    catalogVariantId: string;
    label: string;
    imageUrl: string | null;
    inStock: boolean;
    suggestedPriceCents: number;
  }[],
): StoredVariant[] {
  const byPrintfulId = new Map(existing.map((v) => [v.printfulSyncVariantId, v]));
  return fresh.map((f) => {
    const prior = byPrintfulId.get(f.syncVariantId);
    return {
      id: prior?.id ?? ulid(),
      printfulSyncVariantId: f.syncVariantId,
      printfulCatalogVariantId: f.catalogVariantId,
      label: f.label,
      imageUrl: f.imageUrl,
      inStock: f.inStock,
      priceCents: prior ? prior.priceCents : clampPrice(f.suggestedPriceCents),
    };
  });
}

function clampPrice(cents: unknown): number {
  const n = Math.round(Number(cents));
  if (!Number.isFinite(n) || n < 0) throw new StoreError("Price must be zero or more.");
  if (n > MAX_PRICE_CENTS) throw new StoreError("Price is implausibly high — check the amount.");
  return n;
}

/** Import a Printful design as a new (unpublished) product. */
export async function importProduct(env: Env, syncProductId: string): Promise<StoreProductRow> {
  const existing = await env.DB.prepare(
    `${SELECT_PRODUCT} WHERE printful_sync_product_id = ?`,
  )
    .bind(syncProductId)
    .first<StoreProductRow>();
  if (existing) throw new StoreError("That design is already in the store.");

  const fetched = await getSyncProduct(env, syncProductId);
  if (!fetched.ok) throw new StoreError(`Printful: ${fetched.error}`);

  const variants = mergeVariants([], fetched.value.variants);
  const id = ulid();
  const slug = await uniqueProductSlug(env, slugifyTitle(fetched.value.name));
  const now = nowIso();

  await env.DB.prepare(
    `INSERT INTO store_product
       (id, printful_sync_product_id, slug, printful_title, title_override, blurb,
        image_url, sort_order, published_at, variants_json, synced_at, created_at, updated_at)
     VALUES (?,?,?,?,NULL,NULL,?,?,NULL,?,?,?,?)`,
  )
    .bind(
      id,
      fetched.value.syncProductId,
      slug,
      fetched.value.name.slice(0, MAX_TITLE),
      fetched.value.thumbnailUrl ?? variants.find((v) => v.imageUrl)?.imageUrl ?? null,
      // New items sort to the end; an admin reorders deliberately.
      Date.now() % 1_000_000,
      JSON.stringify(variants),
      now,
      now,
      now,
    )
    .run();

  const row = await productById(env, id);
  if (!row) throw new StoreError("Import failed.");
  return row;
}

/** Re-read a product's variants from Printful, preserving ids and prices. */
export async function syncProduct(env: Env, id: string): Promise<StoreProductRow> {
  const row = await productById(env, id);
  if (!row) throw new StoreError("Product not found.");

  const fetched = await getSyncProduct(env, row.printful_sync_product_id);
  if (!fetched.ok) throw new StoreError(`Printful: ${fetched.error}`);

  const variants = mergeVariants(parseVariants(row), fetched.value.variants);
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE store_product
        SET printful_title = ?, image_url = COALESCE(?, image_url),
            variants_json = ?, synced_at = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      fetched.value.name.slice(0, MAX_TITLE),
      fetched.value.thumbnailUrl ?? null,
      JSON.stringify(variants),
      now,
      now,
      id,
    )
    .run();

  const updated = await productById(env, id);
  if (!updated) throw new StoreError("Product not found.");
  return updated;
}

/** Refresh every imported product. Called from the 3-hourly cron alongside the
 *  calendar refresh — a design discontinued upstream should stop being for sale
 *  without an admin noticing first. Never throws: one bad product must not stop
 *  the rest, exactly as `refreshAllSources` treats one bad ICS feed. */
export async function refreshStoreCatalog(env: Env): Promise<void> {
  if (!env.PRINTFUL_API_KEY) return;
  const rows = await env.DB.prepare("SELECT id FROM store_product").all<{ id: string }>();
  for (const row of rows.results) {
    try {
      await syncProduct(env, row.id);
    } catch (err) {
      console.error(`[store] sync failed for ${row.id}: ${String(err)}`);
    }
  }
}

// ── Admin edits ─────────────────────────────────────────────────────────────

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

export async function patchProduct(
  env: Env,
  id: string,
  body: StoreProductPatchBody,
): Promise<StoreProductRow> {
  const row = await productById(env, id);
  if (!row) throw new StoreError("Product not found.");

  const sets: string[] = [];
  const binds: unknown[] = [];

  if ("titleOverride" in body) {
    sets.push("title_override = ?");
    binds.push(optionalText(body.titleOverride, MAX_TITLE));
  }
  if ("blurb" in body) {
    sets.push("blurb = ?");
    binds.push(optionalText(body.blurb, MAX_BLURB));
  }
  if (body.sortOrder !== undefined) {
    const n = Math.round(Number(body.sortOrder));
    if (!Number.isFinite(n)) throw new StoreError("Sort order must be a number.");
    sets.push("sort_order = ?");
    binds.push(n);
  }
  if (body.published !== undefined) {
    if (body.published && parseVariants(row).length === 0) {
      throw new StoreError("Sync this product from Printful before publishing it — it has no variants.");
    }
    sets.push("published_at = ?");
    binds.push(body.published ? (row.published_at ?? nowIso()) : null);
  }
  if (body.variantPrices) {
    const variants = parseVariants(row);
    const known = new Set(variants.map((v) => v.id));
    for (const variantId of Object.keys(body.variantPrices)) {
      if (!known.has(variantId)) throw new StoreError("Unknown variant in price update.");
    }
    const prices = body.variantPrices;
    const priced = variants.map((v) => {
      const next = prices[v.id];
      return next === undefined ? v : { ...v, priceCents: clampPrice(next) };
    });
    sets.push("variants_json = ?");
    binds.push(JSON.stringify(priced));
  }

  if (sets.length === 0) return row;
  sets.push("updated_at = ?");
  binds.push(nowIso(), id);

  await env.DB.prepare(`UPDATE store_product SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();

  const updated = await productById(env, id);
  if (!updated) throw new StoreError("Product not found.");
  return updated;
}

// ── Cart pricing ────────────────────────────────────────────────────────────

/** A priced cart, plus the Printful ids the rate and order calls need. Those
 *  ids are returned separately from the DTO lines rather than folded into them,
 *  so nothing that goes to a browser has ever held one. */
export interface PricedCart {
  lines: StoreLineDTO[];
  subtotalCents: number;
  printful: { catalogVariantId: string; syncVariantId: string; quantity: number }[];
}

/**
 * Turn what a client asked for into what it actually costs.
 *
 * The client sends variant ids and quantities. It does not send prices, and
 * there is no code path here that would read one if it did — every amount comes
 * from the `store_product` row. Only published products are sellable, and only
 * in-stock variants, both checked here rather than trusted from whatever the
 * storefront happened to render.
 */
export async function priceCart(env: Env, items: StoreCartItemInput[]): Promise<PricedCart> {
  if (!Array.isArray(items) || items.length === 0) throw new StoreError("Your cart is empty.");
  if (items.length > MAX_CART_LINES) throw new StoreError("That's more items than one order can hold.");

  // Tens of products, so one read of the published set beats a query per line —
  // and variants live in JSON, which SQL can't index into anyway.
  const rows = await listProducts(env, true);
  const index = new Map<string, { row: StoreProductRow; variant: StoredVariant }>();
  for (const row of rows) {
    for (const variant of parseVariants(row)) index.set(variant.id, { row, variant });
  }

  const lines: StoreLineDTO[] = [];
  const printful: PricedCart["printful"] = [];
  let subtotalCents = 0;

  for (const item of items) {
    const quantity = Math.floor(Number(item?.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) throw new StoreError("Quantity must be at least 1.");
    if (quantity > MAX_QUANTITY) throw new StoreError(`You can order at most ${MAX_QUANTITY} of one item.`);

    const found = index.get(String(item?.variantId ?? ""));
    // One message for "unpublished", "unknown" and "deleted" alike: they are the
    // same fact to a shopper, and distinguishing them would say which slugs used
    // to exist.
    if (!found) throw new StoreError("An item in your cart is no longer available.");
    if (!found.variant.inStock) {
      throw new StoreError(`${productTitle(found.row)} (${found.variant.label}) is out of stock.`);
    }

    subtotalCents += found.variant.priceCents * quantity;
    lines.push({
      productId: found.row.id,
      variantId: found.variant.id,
      title: productTitle(found.row),
      variantLabel: found.variant.label,
      imageUrl: found.variant.imageUrl,
      unitPriceCents: found.variant.priceCents,
      quantity,
    });
    printful.push({
      catalogVariantId: found.variant.printfulCatalogVariantId,
      syncVariantId: found.variant.printfulSyncVariantId,
      quantity,
    });
  }

  return { lines, subtotalCents, printful };
}

/** Re-check that a quote's frozen lines are still sellable, without re-pricing
 *  them. Called at checkout: an admin unpublishing something mid-flow must fail
 *  the sale, but the price the buyer was shown is the price they pay. */
export async function assertLinesStillSellable(env: Env, lines: StoreLineDTO[]): Promise<void> {
  const rows = await listProducts(env, true);
  const live = new Set<string>();
  for (const row of rows) {
    for (const variant of parseVariants(row)) if (variant.inStock) live.add(variant.id);
  }
  for (const line of lines) {
    if (!live.has(line.variantId)) {
      throw new StoreError(`${line.title} (${line.variantLabel}) is no longer available.`);
    }
  }
}

/** The Printful ids for a set of frozen order lines — resolved at submission
 *  time rather than stored on the order, so a catalog re-point picks up the new
 *  ids without rewriting order history. */
export async function printfulIdsForLines(
  env: Env,
  lines: StoreLineDTO[],
): Promise<{ syncVariantId: string; quantity: number }[]> {
  const rows = await listProducts(env, false);
  const index = new Map<string, StoredVariant>();
  for (const row of rows) {
    for (const variant of parseVariants(row)) index.set(variant.id, variant);
  }
  return lines.map((line) => {
    const variant = index.get(line.variantId);
    if (!variant) throw new StoreError(`Variant ${line.variantId} is no longer in the catalog.`);
    return { syncVariantId: variant.printfulSyncVariantId, quantity: line.quantity };
  });
}
