// The store's authenticated half: an admin's catalog and order screens, and a
// signed-in buyer's own order history.
//
// Two audiences, two gates, deliberately different. `/orders/mine` needs only a
// session and filters on `user_id` in SQL. Everything else is system-admin only,
// checked with the same inline two lines every other admin route in this
// codebase uses (routes/admin.ts, routes/newsletter.ts) rather than a wrapper —
// authorization decisions live next to the session.

import { Hono } from "hono";
import type { StoreProductPatchBody } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { listSyncProducts } from "../lib/printful.js";
import {
  StoreError,
  importProduct,
  listProducts,
  patchProduct,
  productById,
  productDto,
  syncProduct,
} from "../lib/store.js";
import { listOrders, orderById, orderDto, ordersForUser, submitOrder } from "../lib/storeOrder.js";
import { requireAuth } from "../middleware/session.js";

export const store = new Hono<HonoEnv>();

function bad(message: string) {
  return { error: "invalid", message } as const;
}

// ── A member's own orders ───────────────────────────────────────────────────

/** GET /store/orders/mine — orders placed while signed in.
 *
 *  A guest checkout has no `user_id` and will never appear here, by design: the
 *  status link in the confirmation email is that buyer's way back, and matching
 *  guest orders to an account by email address afterwards would let anyone who
 *  signs up with an address see what it once bought. */
store.get("/orders/mine", async (c) => {
  const auth = requireAuth(c);
  return c.json({ orders: (await ordersForUser(c.env, auth.userId)).map(orderDto) });
});

// ── Admin: catalog ──────────────────────────────────────────────────────────

/** GET /store/printful-catalog — everything in the connected Printful store,
 *  marked with whether we already carry it. The admin's import screen. */
store.get("/printful-catalog", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const listed = await listSyncProducts(c.env);
  if (!listed.ok) return c.json(bad(`Printful: ${listed.error}`), 502);

  const imported = await c.env.DB.prepare(
    "SELECT id, printful_sync_product_id FROM store_product",
  ).all<{ id: string; printful_sync_product_id: string }>();
  const byPrintfulId = new Map(imported.results.map((r) => [r.printful_sync_product_id, r.id]));

  return c.json({
    items: listed.value.map((p) => ({
      printfulSyncProductId: p.syncProductId,
      name: p.name,
      thumbnailUrl: p.thumbnailUrl,
      variantCount: p.variantCount,
      importedAs: byPrintfulId.get(p.syncProductId) ?? null,
    })),
  });
});

/** GET /store/products — every product, published or not. */
store.get("/products", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const rows = await listProducts(c.env, false);
  return c.json({ products: rows.map(productDto) });
});

/** POST /store/products { printfulSyncProductId } — import a design.
 *
 *  Arrives UNPUBLISHED. Somebody has to look at the price and the copy before
 *  it is for sale, and defaulting to visible would put Printful's suggested
 *  retail on a public page the moment a design was drafted upstream. */
store.post("/products", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  try {
    const body = await c.req.json<{ printfulSyncProductId?: unknown }>();
    const id = String(body.printfulSyncProductId ?? "").trim();
    if (!id) return c.json(bad("Which product?"), 400);

    const row = await importProduct(c.env, id);
    c.var.audit.push({
      action: "store.product.updated",
      entityKind: "store_product",
      entityId: row.id,
      detail: { op: "imported", printfulSyncProductId: id, title: row.printful_title },
    });
    return c.json({ product: productDto(row) }, 201);
  } catch (err) {
    if (err instanceof StoreError) return c.json(bad(err.message), 400);
    throw err;
  }
});

/** PATCH /store/products/:id — title, blurb, sort, publish, per-variant prices. */
store.patch("/products/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  try {
    const body = await c.req.json<StoreProductPatchBody>();
    const row = await patchProduct(c.env, c.req.param("id"), body);
    // One action for every catalog edit — the economy `newsletter.settings.updated`
    // uses. `detail` carries which keys moved, which is what a reader actually
    // wants from a merchandising change.
    c.var.audit.push({
      action: "store.product.updated",
      entityKind: "store_product",
      entityId: row.id,
      detail: { op: "edited", fields: Object.keys(body), published: row.published_at !== null },
    });
    return c.json({ product: productDto(row) });
  } catch (err) {
    if (err instanceof StoreError) return c.json(bad(err.message), 400);
    throw err;
  }
});

/** POST /store/products/:id/sync — re-read variants from Printful now.
 *
 *  The cron does this every three hours; this is the button for after an admin
 *  has just changed something upstream and doesn't want to wait. */
store.post("/products/:id/sync", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  try {
    const row = await syncProduct(c.env, c.req.param("id"));
    c.var.audit.push({
      action: "store.product.updated",
      entityKind: "store_product",
      entityId: row.id,
      detail: { op: "synced" },
    });
    return c.json({ product: productDto(row) });
  } catch (err) {
    if (err instanceof StoreError) return c.json(bad(err.message), 400);
    throw err;
  }
});

/** DELETE /store/products/:id — only ever an unpublish.
 *
 *  There is no hard delete. A past order's lines are frozen, so nothing would
 *  break — but a removed row means re-importing and re-pricing to sell the same
 *  design next season, and losing the slug that has been in people's messages
 *  all year. "Remove" in the UI means this. */
store.delete("/products/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const row = await productById(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const updated = await patchProduct(c.env, row.id, { published: false });
  c.var.audit.push({
    action: "store.product.updated",
    entityKind: "store_product",
    entityId: row.id,
    detail: { op: "unpublished" },
  });
  return c.json({ product: productDto(updated) });
});

// ── Admin: orders ───────────────────────────────────────────────────────────

/** GET /store/orders?status= — the orders screen.
 *
 *  Unfiltered it deliberately EXCLUDES `abandoned`: an unpaid checkout is real
 *  enough to keep (see migration 0022) but it is not an order, and burying six
 *  real ones under forty abandoned carts is how a stuck order goes unnoticed.
 *  `?status=abandoned` still shows them. */
store.get("/orders", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const rows = await listOrders(c.env, c.req.query("status"));
  return c.json({ orders: rows.map(orderDto) });
});

/** GET /store/orders/:id — one order in full. */
store.get("/orders/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const row = await orderById(c.env, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ order: orderDto(row) });
});

/** POST /store/orders/:id/retry — put a given-up order back in the loop.
 *
 *  Resets `submit_attempts` and returns it to `paid`, which is the state the
 *  cron re-drive scans for; the submission itself then goes through the same
 *  claim as every other path, so pressing this twice cannot double-submit. */
store.post("/orders/:id/retry", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);

  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    `UPDATE store_order SET status = 'paid', submit_attempts = 0, updated_at = ?
      WHERE id = ? AND status = 'fulfillment_failed'`,
  )
    .bind(new Date().toISOString(), id)
    .run();
  if (!res.meta || res.meta.changes === 0) {
    return c.json(bad("That order isn't waiting on a retry."), 409);
  }

  // Pushed here, the moment the guarded UPDATE claimed the row, and before the
  // resubmission below — which can fail on its own. Same ordering rule, and the
  // same shape of act, as `newsletter.issue.retried`.
  c.var.audit.push({
    action: "store.order.retried",
    entityKind: "store_order",
    entityId: id,
  });

  c.executionCtx.waitUntil(submitOrder(c.env, id));
  const row = await orderById(c.env, id);
  return c.json({ order: row ? orderDto(row) : null });
});
