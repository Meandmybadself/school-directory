// Minimal admin console: list Users and masquerade as one. The fuller console
// (CSV import, audit-log table, registration toggle) is M4.
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { AdminUserDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useI18n } from "../i18n/index.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";

export function Admin() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, refresh } = useSession();
  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.adminUsers().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);

  if (me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const masquerade = async (userId: string) => {
    setBusy(userId);
    try {
      await api.startMasquerade(userId);
      await refresh();
      navigate("/");
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <>
      <SectLabel>Members &amp; sign-in accounts</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
        {users.map((u) => {
          const isSelf = u.id === me?.user.id;
          return (
            <div key={u.id} className="sd-mrow">
              <Avatar name={u.email} size={38} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                  {u.isSystemAdmin && <Tag tone="line"><Icon name="shield" size={11} stroke={2} />Admin</Tag>}
                  {isSelf && <Tag tone="blue">You</Tag>}
                </div>
                <div className="sd-meta">{u.personCount} {u.personCount === 1 ? "person" : "people"}</div>
              </div>
              {!isSelf && (
                <button className="sd-btn sd-btn-secondary sd-btn-sm" disabled={busy === u.id} onClick={() => void masquerade(u.id)}>
                  <Icon name="eye" size={15} />Masquerade
                </button>
              )}
            </div>
          );
        })}
        {users.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No users.</div>}
      </div>
      <div className="sd-row" style={{ gap: 8, marginTop: 14, padding: "11px 14px", background: "var(--bg-2)", borderRadius: 12, color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.4 }}>
        <Icon name="info" size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
        Masquerading is recorded in the audit log. A persistent banner shows while you're viewing as another member.
      </div>
    </>
  );

  if (isDesktop) {
    return <DesktopShell active="admin" title="Admin"><div style={{ maxWidth: 680 }}>{body}</div></DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="me" />}>
      <ScreenHeader title="Admin" onLeft={() => navigate("/")} />
      <div className="sd-scroll"><div className="sd-body">{body}</div></div>
    </AppShell>
  );
}
