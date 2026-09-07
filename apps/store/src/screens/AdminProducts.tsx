// Admin: the catalog.
//
// This is the screen the whole "admins administrate the inventory" ask resolves
// to, and what it does NOT do is as deliberate as what it does. Designs, mockups
// and variants are Printful's — you cannot make a t-shirt without their mockup
// generator, and a second place to do it would only drift. What a PTO actually
// needs to control is here: whether an item is for sale, what it is called, what
// it says, what each size costs, and what order things appear in.
//
// "Add" imports a Printful design as an UNPUBLISHED product. "Remove" unpublishes
// it — there is no hard delete, because a past order's lines are frozen and the
// only thing a delete would buy is having to re-import and re-price the same
// design next season, losing the slug people have been sharing all year.
//
// English-only by convention, like the calendar's and newsletter's admin screens.

import { useEffect, useState } from "react";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { Btn, Tag } from "../components/atoms.js";
import { ScreenHeader } from "../components/parts.js";
import { SiteFooter } from "../components/SiteFooter.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage, money } from "../lib/api.js";
import type { StorePrintfulCatalogItemDTO, StoreProductDTO } from "@sd/shared";

function ProductCard({
  product,
  onChange,
  onError,
}: {
  product: StoreProductDTO;
  onChange: (next: StoreProductDTO) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(product.titleOverride ?? "");
  const [blurb, setBlurb] = useState(product.blurb ?? "");
  // Prices are edited as dollar strings and converted once, on save. Keeping
  // cents in the input would make "24.5" mean 24 cents to a distracted admin.
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.variants.map((v) => [v.id, (v.priceCents / 100).toFixed(2)])),
  );

  const run = async (fn: () => Promise<{ product: StoreProductDTO }>) => {
    setBusy(true);
    try {
      onChange((await fn()).product);
    } catch (err) {
      onError(errorMessage(err, "That didn't save."));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      api.patchProduct(product.id, {
        titleOverride: title.trim() || null,
        blurb: blurb.trim() || null,
        variantPrices: Object.fromEntries(
          Object.entries(prices)
            .map(([id, value]) => [id, Math.round(Number(value) * 100)] as const)
            .filter(([, cents]) => Number.isFinite(cents) && cents >= 0),
        ),
      }),
    );

  return (
    <div className="sd-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="sd-row" style={{ gap: 12, alignItems: "flex-start" }}>
        {product.imageUrl && (
          <img
            src={product.imageUrl}
            alt=""
            width={56}
            height={56}
            style={{ borderRadius: "var(--r-sm)", objectFit: "cover", flex: "0 0 auto" }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>{product.title}</div>
          <div className="sd-meta">/p/{product.slug}</div>
        </div>
        {product.published ? <Tag tone="blue">Published</Tag> : <Tag tone="line">Draft</Tag>}
      </div>

      <label className="sd-label" htmlFor={`title-${product.id}`}>
        Title — leave blank to use Printful's ({product.printfulTitle})
      </label>
      <input
        id={`title-${product.id}`}
        className="sd-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label className="sd-label" htmlFor={`blurb-${product.id}`}>Description</label>
      <textarea
        id={`blurb-${product.id}`}
        className="sd-input"
        rows={2}
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
      />

      <div className="sd-label">Price per size</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {product.variants.map((variant) => (
          <div key={variant.id} className="sd-row" style={{ gap: 8 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {variant.label}
              {!variant.inStock && <span className="sd-meta"> · out of stock</span>}
            </span>
            <input
              className="sd-input"
              type="number"
              min={0}
              step="0.01"
              aria-label={`Price for ${variant.label}`}
              value={prices[variant.id] ?? ""}
              onChange={(e) => setPrices((p) => ({ ...p, [variant.id]: e.target.value }))}
              style={{ width: 96, padding: "4px 8px" }}
            />
          </div>
        ))}
        {product.variants.length === 0 && (
          <p className="sd-meta">No variants cached yet — sync this product from Printful.</p>
        )}
      </div>

      <div className="sd-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Btn kind="primary" sm disabled={busy} onClick={() => void save()}>Save</Btn>
        <Btn
          kind="secondary"
          sm
          disabled={busy}
          onClick={() => void run(() => api.patchProduct(product.id, { published: !product.published }))}
        >
          {product.published ? "Unpublish" : "Publish"}
        </Btn>
        <Btn kind="ghost" sm disabled={busy} onClick={() => void run(() => api.syncProduct(product.id))}>
          Sync from Printful
        </Btn>
        <div style={{ flex: 1 }} />
        <span className="sd-meta">
          {product.variants.length > 0 &&
            `from ${money(Math.min(...product.variants.map((v) => v.priceCents)))}`}
        </span>
      </div>
    </div>
  );
}

function Body() {
  const [products, setProducts] = useState<StoreProductDTO[] | null>(null);
  const [catalog, setCatalog] = useState<StorePrintfulCatalogItemDTO[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    api.adminProducts().then((res) => setProducts(res.products)).catch(() => setError("Couldn't load products."));
  }, []);

  const loadCatalog = async () => {
    setCatalogError(null);
    try {
      setCatalog((await api.printfulCatalog()).items);
    } catch (err) {
      // The commonest cause by far is no PRINTFUL_API_KEY, which is the normal
      // state in local dev — say so rather than showing a bare failure.
      setCatalogError(errorMessage(err, "Couldn't reach Printful. Is PRINTFUL_API_KEY set?"));
    }
  };

  const doImport = async (printfulSyncProductId: string) => {
    setImporting(printfulSyncProductId);
    try {
      const { product } = await api.importProduct(printfulSyncProductId);
      setProducts((list) => [...(list ?? []), product]);
      setCatalog((items) =>
        (items ?? []).map((i) =>
          i.printfulSyncProductId === printfulSyncProductId ? { ...i, importedAs: product.id } : i,
        ),
      );
    } catch (err) {
      setError(errorMessage(err, "Couldn't import that design."));
    } finally {
      setImporting(null);
    }
  };

  return (
    <div style={{ padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
      {error && <p className="sd-lead" style={{ color: "var(--warn)", fontSize: 13.5 }}>{error}</p>}

      <div className="sd-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="sd-h2">Products</span>
        <Btn kind="secondary" sm onClick={() => void loadCatalog()}>Add from Printful</Btn>
      </div>

      {catalogError && <p className="sd-lead" style={{ color: "var(--warn)", fontSize: 13.5 }}>{catalogError}</p>}

      {catalog && (
        <div className="sd-card" style={{ padding: 4 }}>
          {catalog.map((item) => (
            <div key={item.printfulSyncProductId} className="sd-crow">
              {item.thumbnailUrl && (
                <img src={item.thumbnailUrl} alt="" width={36} height={36} style={{ borderRadius: 8, objectFit: "cover" }} />
              )}
              <div className="sd-cmain">
                <div style={{ fontWeight: 600 }}>{item.name}</div>
                <div className="sd-meta">{item.variantCount} variants</div>
              </div>
              {item.importedAs ? (
                <Tag tone="line">Added</Tag>
              ) : (
                <Btn
                  kind="primary"
                  sm
                  disabled={importing === item.printfulSyncProductId}
                  onClick={() => void doImport(item.printfulSyncProductId)}
                >
                  Add
                </Btn>
              )}
            </div>
          ))}
          {catalog.length === 0 && <p className="sd-meta" style={{ padding: 12 }}>Nothing in that Printful store yet.</p>}
        </div>
      )}

      {!products && <div className="sd-boot"><div className="sd-spinner" /></div>}
      {products?.length === 0 && <p className="sd-lead">Nothing imported yet.</p>}
      {products?.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onChange={(next) => setProducts((list) => (list ?? []).map((p) => (p.id === next.id ? next : p)))}
          onError={setError}
        />
      ))}
    </div>
  );
}

export function AdminProducts() {
  const desktop = useIsDesktop();

  if (desktop) {
    return (
      <DesktopShell active="admin" title="Store admin">
        <Body />
        <SiteFooter />
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Store admin" />
      <div className="sd-scroll">
        <Body />
      </div>
    </AppShell>
  );
}
