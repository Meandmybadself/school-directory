import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { AppShell } from "./components/AppShell.js";
import { Btn } from "./components/atoms.js";
import { Icon } from "./components/Icon.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Home } from "./screens/Home.js";
import { ProfileView, ProfileEdit } from "./screens/Profile.js";

function Loading() {
  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
        <div className="sd-spinner" />
        <div style={{ textAlign: "center" }}>
          <div className="sd-h2">Signing you in…</div>
          <div className="sd-lead" style={{ fontSize: 13.5, marginTop: 4 }}>One moment while we open the directory.</div>
        </div>
      </div>
    </AppShell>
  );
}

function Stub({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <AppShell>
      <div className="sd-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center" }}>
        <Icon name="bolt" size={30} style={{ color: "var(--ink-3)" }} />
        <div>
          <div className="sd-h2">{title}</div>
          <p className="sd-lead" style={{ fontSize: 13.5, marginTop: 6 }}>This area arrives in a later milestone (see PLAN.md).</p>
        </div>
        <Btn kind="secondary" icon="arrowleft" onClick={() => navigate("/")}>Home</Btn>
      </div>
    </AppShell>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/check-email" element={<CheckEmail />} />

      <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
      <Route path="/persons/:id" element={<RequireAuth><ProfileView /></RequireAuth>} />
      <Route path="/persons/:id/edit" element={<RequireAuth><ProfileEdit /></RequireAuth>} />
      <Route path="/persons/:id/invite" element={<RequireAuth><Stub title="Invite a co-manager" /></RequireAuth>} />

      <Route path="/directory" element={<RequireAuth><Stub title="Directory" /></RequireAuth>} />
      <Route path="/groups" element={<RequireAuth><Stub title="Groups" /></RequireAuth>} />
      <Route path="/groups/:id" element={<RequireAuth><Stub title="Group" /></RequireAuth>} />
      <Route path="/you" element={<RequireAuth><Stub title="You" /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
