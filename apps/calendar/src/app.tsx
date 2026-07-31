import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { takeReturnPath } from "./lib/returnPath.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Calendar } from "./screens/Calendar.js";
import { Admin } from "./screens/Admin.js";
import { CalendarEvents } from "./screens/CalendarEvents.js";
import { EventVolunteers } from "./screens/EventVolunteers.js";
import { VolunteerSheet } from "./screens/VolunteerSheet.js";

/** Shown while the session resolves. Renders the `.sd` token scope directly
 *  rather than going through AppShell: the shell's `.sd-app` is the mobile
 *  phone-frame column, so on a desktop it wrapped this spinner in a narrow
 *  drop-shadowed card that vanished the moment the real (full-width) screen
 *  took over. Nothing here needs a shell — there is no nav or app bar yet. */
function Loading() {
  return (
    <div className="sd">
      <div className="sd-boot">
        <div className="sd-spinner" />
        <div>
          <div className="sd-h2">Signing you in…</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the calendar.</div>
        </div>
      </div>
    </div>
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

/** Finish a deep sign-in. The magic link can only carry an ORIGIN (the API
 *  validates `returnTo` against ALLOWED_ORIGINS by exact match), so someone who
 *  started signing in from a volunteer sheet lands back at `/`. The path was
 *  stashed before they left; take it once they actually have a session.
 *  See lib/returnPath.ts. */
function ReturnToStashedPath() {
  const { loading, me } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    // Only from the landing route, and only once signed in — otherwise a failed
    // link would yank someone off the agenda they deliberately opened.
    if (loading || !me || pathname !== "/") return;
    const path = takeReturnPath();
    if (path && path !== "/") navigate(path, { replace: true });
  }, [loading, me, pathname, navigate]);

  return null;
}

export function App() {
  return (
    <>
      <ReturnToStashedPath />
      <Routes>
        <Route path="/sign-in" element={<RedirectIfAuthed><SignIn /></RedirectIfAuthed>} />
        <Route path="/check-email" element={<CheckEmail />} />

        {/* Ungated on purpose: the agenda is public read-only. It reads the
            /calendar-public/* routes, which need no cookie, and the shell hides
            every member affordance when `me` is null. Admin stays gated below —
            both here and, authoritatively, on the server. */}
        <Route path="/" element={<Calendar />} />

        {/* Also ungated, and for the same reason: a volunteer sheet's whole job
            is to open from a text message. The screen asks the anonymous
            endpoint when there's no session, so a signed-out reader gets counts
            and never names — see VolunteerSheet.tsx. Claiming a spot is a write
            and needs a session, which the API enforces. */}
        <Route path="/v/:slug" element={<VolunteerSheet />} />

        <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
        <Route path="/admin/calendars/:id" element={<RequireAuth><CalendarEvents /></RequireAuth>} />
        <Route path="/admin/events/:id/volunteers" element={<RequireAuth><EventVolunteers /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
