import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { useI18n } from "./i18n/index.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Cart } from "./screens/Cart.js";
import { MyOrders } from "./screens/MyOrders.js";
import { AdminProducts } from "./screens/AdminProducts.js";
import { AdminOrders } from "./screens/AdminOrders.js";

/** Shown while the session resolves. Renders the `.sd` token scope directly
 *  rather than going through AppShell, for the reason the sibling apps give:
 *  `.sd-app` is the mobile phone-frame column, so on a desktop it would wrap a
 *  spinner in a narrow drop-shadowed card that vanishes when the real screen
 *  takes over. */
function Loading() {
  return (
    <div className="sd">
      <div className="sd-boot">
        <div className="sd-spinner" />
      </div>
    </div>
  );
}

/** Authoring is admin-only. A signed-in shopper who lands here goes to their own
 *  orders rather than being shown a bare "forbidden".
 *
 *  A UI nicety only — every route behind it is independently gated server-side
 *  (routes/store.ts checks `isSystemAdmin` inline). */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!me.user.isSystemAdmin) return <Navigate to="/orders" replace />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to={me.user.isSystemAdmin ? "/admin" : "/orders"} replace />;
  return <>{children}</>;
}

/** The bundle's entry point for a sibling app to link at.
 *
 *  `/app` exists for the same reason the newsletter's does: in production `/` is
 *  a Pages Function (the storefront) and never reaches this router, so there has
 *  to be ONE bundle URL another app can link to without knowing whether the
 *  visitor is an admin, a shopper or a stranger. Link there, not at the bare
 *  origin — the bare origin is the shop.
 */
function Home() {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/cart" replace />;
  return <Navigate to={me.user.isSystemAdmin ? "/admin" : "/orders"} replace />;
}

/** `/` only reaches this router under `vite dev`, where there are no Functions.
 *  Rather than render a second, drifting copy of the storefront just for local
 *  development, say so and point at the two places that do work. */
function DevStorefrontNote() {
  const { t } = useI18n();
  return (
    <div className="sd">
      <div style={{ maxWidth: 560, margin: "48px auto", padding: 20 }}>
        <div className="sd-h2">{t("storeTitle")}</div>
        <p className="sd-lead" style={{ marginTop: 8 }}>
          The storefront is server-rendered by Pages Functions, so it only exists under{" "}
          <code>wrangler pages dev</code> and in production — not under <code>vite dev</code>.
          See ROUTING.md.
        </p>
        <p className="sd-lead">
          <a className="sd-link" href="/cart">
            Cart
          </a>{" "}
          ·{" "}
          <a className="sd-link" href="/admin">
            Admin
          </a>
        </p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
      <Route path="/check-email" element={<CheckEmail />} />

      {/* No auth: buying does not require an account. */}
      <Route path="/cart" element={<Cart />} />

      <Route path="/orders" element={<RequireAuth><MyOrders /></RequireAuth>} />

      <Route path="/admin" element={<RequireAdmin><AdminProducts /></RequireAdmin>} />
      <Route path="/admin/orders" element={<RequireAdmin><AdminOrders /></RequireAdmin>} />

      {/* The production entry point — see Home. */}
      <Route path="/app" element={<Home />} />
      {/* Claimed by a Function in production; this is the dev-only fallback. */}
      <Route path="/" element={<DevStorefrontNote />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
