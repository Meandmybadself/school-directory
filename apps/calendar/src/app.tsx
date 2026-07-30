import { Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { AppShell } from "./components/AppShell.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Calendar } from "./screens/Calendar.js";
import { Admin } from "./screens/Admin.js";
import { CalendarEvents } from "./screens/CalendarEvents.js";

function Loading() {
  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
        <div className="sd-spinner" />
        <div style={{ textAlign: "center" }}>
          <div className="sd-h2">Signing you in…</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the calendar.</div>
        </div>
      </div>
    </AppShell>
  );
}

/** Members-only, like the directory. The gate is RequireAuth rather than the
 *  directory's RequireProfile: the calendar is shared, not Person-scoped, so
 *  there's no reason to push someone through profile onboarding to read it. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
      <Route path="/check-email" element={<CheckEmail />} />

      <Route path="/" element={<RequireAuth><Calendar /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/admin/calendars/:id" element={<RequireAuth><CalendarEvents /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
