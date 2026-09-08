import { Navigate, Route, Routes } from "react-router-dom";
import { useAccess } from "./lib/access.js";
import { useSession } from "./lib/session.js";
import { useI18n } from "./i18n/index.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Boards } from "./screens/Boards.js";
import { Board } from "./screens/Board.js";
import { NoAccess } from "./screens/NoAccess.js";
import { Settings } from "./screens/Settings.js";

/** Shown while the session and the PTO-board gate resolve. Renders the `.sd`
 *  token scope directly rather than going through AppShell, for the reason the
 *  sibling apps give: `.sd-app` is the mobile phone-frame column, so on a
 *  desktop it would wrap a spinner in a narrow drop-shadowed card that vanishes
 *  when the real screen takes over. */
function Loading() {
  return (
    <div className="sd">
      <div className="sd-boot">
        <div className="sd-spinner" />
      </div>
    </div>
  );
}

/**
 * The two gates, in order, and the order is the point.
 *
 * "Not signed in" and "signed in but not on the board" are different answers and
 * need different screens: conflating them would show a member who is merely
 * logged out the "ask a board member" card instead of a sign-in form, and would
 * show a parent who genuinely isn't on the board a login page they can complete
 * and still get nowhere.
 *
 * Both are UI conveniences. Every `/pto/*` route re-resolves the same gate
 * server-side in `ptoAccess`, so this decides what to RENDER, never what is
 * permitted.
 */
function RequireBoard({ children }: { children: React.ReactNode }) {
  const { loading: sessionLoading, me } = useSession();
  const { loading, access } = useAccess();
  if (sessionLoading || loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!access?.canUse) return <NoAccess />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!me.user.isSystemAdmin) return <Navigate to="/boards" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/** The bundle's entry point for a sibling app — or the public page's footer — to
 *  link at.
 *
 *  `/app` exists for the reason the newsletter's and the store's do: in
 *  production `/` is a Pages Function (the public page) and never reaches this
 *  router, so there has to be ONE bundle URL another app can link to without
 *  knowing whether the visitor is a board member, an ordinary parent or a
 *  stranger. Link there, not at the bare origin — the bare origin is the
 *  brochure. */
function Home() {
  const { loading, me } = useSession();
  const { loading: accessLoading, access } = useAccess();
  if (loading || accessLoading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!access?.canUse) return <NoAccess />;
  return <Navigate to="/boards" replace />;
}

/** `/` only reaches this router under `vite dev`, where there are no Functions.
 *  Rather than render a second, drifting copy of the public page just for local
 *  development, say so and point at the parts that do work. */
function DevPublicPageNote() {
  const { t } = useI18n();
  return (
    <div className="sd">
      <div style={{ maxWidth: 560, margin: "48px auto", padding: 20 }}>
        <div className="sd-h2">{t("ptoTitle")}</div>
        <p className="sd-lead" style={{ marginTop: 8 }}>
          The public page is server-rendered by Pages Functions, so it only exists under{" "}
          <code>wrangler pages dev</code> and in production — not under <code>vite dev</code>. See
          ROUTING.md.
        </p>
        <p className="sd-lead">
          <a className="sd-link" href="/app">
            Boards
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

      <Route path="/boards" element={<RequireBoard><Boards /></RequireBoard>} />
      <Route path="/b/:slug" element={<RequireBoard><Board /></RequireBoard>} />
      <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />

      {/* The production entry point — see Home. */}
      <Route path="/app" element={<Home />} />
      {/* Claimed by a Function in production; this is the dev-only fallback. */}
      <Route path="/" element={<DevPublicPageNote />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
