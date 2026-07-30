import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { AppShell } from "./components/AppShell.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Issues } from "./screens/Issues.js";
import { IssueEditor } from "./screens/IssueEditor.js";
import { Settings } from "./screens/Settings.js";
import { Subscribers } from "./screens/Subscribers.js";
import { Preferences } from "./screens/Preferences.js";
import { Unsubscribe } from "./screens/Unsubscribe.js";

function Loading() {
  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
        <div className="sd-spinner" />
        <div style={{ textAlign: "center" }}>
          <div className="sd-h2">Signing you in…</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the newsletter.</div>
        </div>
      </div>
    </AppShell>
  );
}

/** Members-only, like the calendar app — the gate is RequireAuth rather than the
 *  directory's RequireProfile, since nothing here is Person-scoped. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

/** Authoring is admin-only. A signed-in member who lands here is sent to the one
 *  screen that is theirs rather than shown a bare "forbidden". */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (!me.user.isSystemAdmin) return <Navigate to="/preferences" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

/** Where "home" is depends on who you are: admins author, members subscribe.
 *  In production `/` never reaches this router — the public archive at `/` and
 *  `/n/:slug` is served by Pages Functions, and _redirects only falls back to
 *  this bundle for the routes below. It matters in `vite dev`, where there are
 *  no Functions.
 *
 *  Because `/` is unreachable in production, `/app` is mounted on this same
 *  component as the app's real entry point: it is the ONE URL that sibling apps
 *  and the public archive can link to without knowing whether the visitor is an
 *  admin, a member, or signed out. Link there, not at the bare origin — the bare
 *  origin is the reader-facing archive and has no way into the app. */
function Home() {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <Navigate to={me.user.isSystemAdmin ? "/admin" : "/preferences"} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
      <Route path="/check-email" element={<CheckEmail />} />

      {/* No auth: the link arrives in an email, and requiring a sign-in to stop
          receiving mail is exactly the dark pattern the unsubscribe rules exist
          to prevent. */}
      <Route path="/unsubscribe/:token" element={<Unsubscribe />} />

      <Route path="/preferences" element={<RequireAuth><Preferences /></RequireAuth>} />

      <Route path="/admin" element={<RequireAdmin><Issues /></RequireAdmin>} />
      <Route path="/admin/issues/:id" element={<RequireAdmin><IssueEditor /></RequireAdmin>} />
      <Route path="/admin/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
      <Route path="/admin/subscribers" element={<RequireAdmin><Subscribers /></RequireAdmin>} />

      {/* The production entry point — see Home. `/` only resolves here in dev. */}
      <Route path="/app" element={<Home />} />
      <Route path="/" element={<Home />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}
