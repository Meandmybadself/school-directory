import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useSession } from "./lib/session.js";
import { AppShell } from "./components/AppShell.js";
import { Btn } from "./components/atoms.js";
import { Icon } from "./components/Icon.js";
import { SignIn, CheckEmail } from "./screens/Onboarding.js";
import { Home } from "./screens/Home.js";
import { ProfileView, ProfileEdit } from "./screens/Profile.js";
import { GroupDetail, GroupsIndex } from "./screens/Group.js";
import { Admin } from "./screens/Admin.js";
import { Import } from "./screens/Import.js";
import { Directory } from "./screens/Directory.js";
import { CreateProfile } from "./screens/CreateProfile.js";
import { AddPerson } from "./screens/AddPerson.js";
import { DesktopShell } from "./components/DesktopShell.js";
import { useIsDesktop } from "./lib/useIsDesktop.js";

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

function Stub({ title, nav = "home" }: { title: string; nav?: "home" | "dir" | "groups" | "profile" }) {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const body = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 40, textAlign: "center", minHeight: 280 }}>
      <Icon name="bolt" size={30} style={{ color: "var(--ink-3)" }} />
      <div>
        <div className="sd-h2">{title}</div>
        <p className="sd-lead" style={{ fontSize: 13.5, marginTop: 6 }}>This area arrives in a later milestone (see PLAN.md).</p>
      </div>
      <Btn kind="secondary" icon="arrowleft" onClick={() => navigate("/")}>Home</Btn>
    </div>
  );
  if (isDesktop) return <DesktopShell active={nav} title={title}>{body}</DesktopShell>;
  return <AppShell><div className="sd-scroll">{body}</div></AppShell>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

/** Routes that act on an active Person; a user with none is sent to onboarding. */
function RequireProfile({ children }: { children: React.ReactNode }) {
  const { loading, me } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace />;
  if (me.persons.length === 0) return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/check-email" element={<CheckEmail />} />

      <Route path="/welcome" element={<RequireAuth><CreateProfile /></RequireAuth>} />

      <Route path="/" element={<RequireProfile><Home /></RequireProfile>} />
      <Route path="/persons/new" element={<RequireProfile><AddPerson /></RequireProfile>} />
      <Route path="/persons/:id" element={<RequireProfile><ProfileView /></RequireProfile>} />
      <Route path="/persons/:id/edit" element={<RequireProfile><ProfileEdit /></RequireProfile>} />
      <Route path="/persons/:id/invite" element={<RequireProfile><Stub title="Invite a co-manager" /></RequireProfile>} />

      <Route path="/directory" element={<RequireProfile><Directory /></RequireProfile>} />
      <Route path="/groups" element={<RequireProfile><GroupsIndex /></RequireProfile>} />
      <Route path="/groups/:id" element={<RequireProfile><GroupDetail /></RequireProfile>} />
      <Route path="/you" element={<RequireProfile><Stub title="You" nav="profile" /></RequireProfile>} />
      <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
      <Route path="/admin/import" element={<RequireAuth><Import /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
