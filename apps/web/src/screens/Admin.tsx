// Admin console: registration toggle, masquerade (user list), and the
// append-only audit log. CSV bulk import + co-manager invite UI remain M4.
// Admin chrome is intentionally English-only (operator tooling).
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { AdminUserDTO, AuditEntryDTO, NewUserNotify } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, ApiError, CALENDAR_APP_URL, NEWSLETTER_APP_URL } from "../lib/api.js";

// The audit log is instance-wide, so the calendar actions stay filterable here
// even though the UI that performs them now lives in the calendar app.
const ACTION_FILTERS = [
  "", "auth.signin", "invite.sent", "invite.accepted", "control.granted",
  "masquerade.start", "masquerade.stop", "share.created", "share.revoked",
  "person.updated", "contact.created", "contact.updated", "registration.toggled", "notify.toggled", "admin.action",
  "calendar.source.created", "calendar.source.updated", "calendar.source.deleted", "calendar.refreshed",
  "calendar.managed.created", "calendar.managed.updated", "calendar.managed.deleted",
  "calendar.event.created", "calendar.event.updated", "calendar.event.deleted",
];

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** New-member notifications: a master switch plus, when on, the delivery mode.
 *  "off" is the stored default, so a fresh instance emails nobody. */
function NotificationsSection() {
  const [mode, setMode] = useState<NewUserNotify | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.getNotifications().then((r) => setMode(r.newUser)).catch(() => setMode(null));
  }, []);

  const save = async (next: NewUserNotify) => {
    const prev = mode;
    setMode(next); // optimistic
    setBusy(true);
    try {
      const r = await api.setNotifications(next);
      setMode(r.newUser);
    } catch {
      setMode(prev ?? null); // revert on failure
    } finally {
      setBusy(false);
    }
  };

  const on = mode !== null && mode !== "off";
  const choices: [NewUserNotify, string, string][] = [
    ["instant", "Right away", "One email per person, as they join."],
    ["daily", "Daily digest", "One summary each morning (~8am), only if anyone joined."],
  ];

  return (
    <div style={{ marginTop: 18 }}>
      <SectLabel>Notifications</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        <div className="sd-row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Email admins about new members</div>
            <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>
              {on
                ? "Every system admin gets a notice when someone signs up or accepts an invite."
                : "Nobody is notified when someone joins."}
            </div>
          </div>
          <button
            className={`sd-toggle${on ? " on" : ""}`}
            aria-pressed={on}
            aria-label="Toggle new-member notifications"
            disabled={mode === null || busy}
            onClick={() => void save(on ? "off" : "instant")}
          />
        </div>

        {on && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {choices.map(([value, label, help]) => (
              <label key={value} className="sd-row" style={{ gap: 9, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="new-user-notify"
                  checked={mode === value}
                  disabled={busy}
                  onChange={() => void save(value)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{label}</span>
                  <span className="sd-meta" style={{ display: "block", lineHeight: 1.4 }}>{help}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="sd-meta" style={{ marginTop: 10, lineHeight: 1.4 }}>
          Accounts you create yourself don't send a notice. Switching to the digest starts
          the window now — people who joined earlier won't be replayed.
        </div>
      </div>
    </div>
  );
}

/** Create a sign-in account, optionally suppressing the welcome email. */
function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [sysAdmin, setSysAdmin] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ email: email.trim(), isSystemAdmin: sysAdmin, sendEmail });
      setEmail("");
      setSysAdmin(false);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "That email already has an account." : "Couldn't create the user.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 4 }}>
      <input className="sd-input" type="email" placeholder="new.member@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="sd-row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
        Email them a sign-in link
      </label>
      <label className="sd-row" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={sysAdmin} onChange={(e) => setSysAdmin(e.target.checked)} />
        System admin
      </label>
      <div className="sd-meta" style={{ lineHeight: 1.4 }}>
        The account works immediately; they can sign in any time via “Email me a link” even with sign-ups closed.
      </div>
      <Btn type="submit" icon="plus" disabled={busy || !email.trim()}>Create user</Btn>
      {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}
    </form>
  );
}

export function Admin() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, refresh } = useSession();

  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<AuditEntryDTO[]>([]);
  const [filter, setFilter] = useState("");
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [tab, setTab] = useState<"users" | "audit">("users");

  const loadUsers = () => void api.adminUsers().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => {
    loadUsers();
    void api.getRegistration().then((r) => setRegOpen(r.open)).catch(() => setRegOpen(null));
  }, []);

  useEffect(() => {
    void api.auditLog({ action: filter || undefined }).then((r) => {
      setEntries(r.entries);
      setNextBefore(r.nextBefore);
    }).catch(() => setEntries([]));
  }, [filter]);

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

  /** Grant or revoke system admin. Optimistic; reverts if the API says no. */
  const setAdmin = async (userId: string, next: boolean) => {
    setBusy(`role:${userId}`);
    setUsersError(null);
    setUsers((list) => list.map((u) => (u.id === userId ? { ...u, isSystemAdmin: next } : u)));
    try {
      const r = await api.setUserAdmin(userId, next);
      setUsers((list) => list.map((u) => (u.id === userId ? r.user : u)));
    } catch {
      setUsers((list) => list.map((u) => (u.id === userId ? { ...u, isSystemAdmin: !next } : u)));
      setUsersError(`Couldn't ${next ? "grant" : "remove"} admin for that account.`);
    } finally {
      setBusy(null);
    }
  };

  const toggleReg = async () => {
    if (regOpen === null) return;
    const next = !regOpen;
    setRegOpen(next);
    try {
      const r = await api.setRegistration(next);
      setRegOpen(r.open);
    } catch {
      setRegOpen(!next); // revert on failure
    }
  };

  const loadMore = async () => {
    if (!nextBefore) return;
    const r = await api.auditLog({ action: filter || undefined, before: nextBefore });
    setEntries((e) => [...e, ...r.entries]);
    setNextBefore(r.nextBefore);
  };

  const tabs: [typeof tab, string][] = [["users", "Users"], ["audit", "Audit log"]];
  const tabBar = (
    <div className="sd-row" style={{ gap: 2, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => setTab(key)}
          style={{
            padding: "9px 14px", border: 0, background: "none", font: "inherit", cursor: "pointer",
            fontSize: 13.5, fontWeight: 700, marginBottom: -1,
            color: tab === key ? "var(--blue)" : "var(--ink-3)",
            borderBottom: `2px solid ${tab === key ? "var(--blue)" : "transparent"}`,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const usersTab = (
    <>
      {/* Registration toggle */}
      <SectLabel>Sign-ups</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        <div className="sd-row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Open registration</div>
            <div className="sd-meta" style={{ marginTop: 2, lineHeight: 1.4 }}>
              {regOpen
                ? "Anyone with an unknown email can request a sign-in link."
                : "New sign-ups are closed. Admins can still invite."}
            </div>
          </div>
          <button
            className={`sd-toggle${regOpen ? " on" : ""}`}
            aria-pressed={!!regOpen}
            aria-label="Toggle registration"
            disabled={regOpen === null}
            onClick={() => void toggleReg()}
          />
        </div>
      </div>

      <NotificationsSection />

      {/* Bulk import */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Import</SectLabel>
        <div className="sd-card" style={{ marginTop: 9, padding: 13, display: "flex", alignItems: "center", gap: 11, cursor: "pointer" }} onClick={() => navigate("/admin/import")}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="table" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Bulk import (CSV)</div>
            <div className="sd-meta">Add members &amp; groups from a roster file, with a dry-run.</div>
          </div>
          <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
        </div>
      </div>

      {/* Calendar admin — moved to the calendar app; linked so it stays findable. */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Calendar</SectLabel>
        <a
          className="sd-card"
          href={`${CALENDAR_APP_URL}/admin`}
          style={{ marginTop: 9, padding: 13, display: "flex", alignItems: "center", gap: 11, color: "inherit", textDecoration: "none" }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="calendar" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Calendar admin</div>
            <div className="sd-meta">Manage calendars, events &amp; imported ICS feeds on the calendar site.</div>
          </div>
          <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
        </a>
      </div>

      {/* Newsletter admin — its own site, like the calendar. */}
      <div style={{ marginTop: 18 }}>
        <SectLabel>Newsletter</SectLabel>
        <a
          className="sd-card"
          href={`${NEWSLETTER_APP_URL}/admin`}
          style={{ marginTop: 9, padding: 13, display: "flex", alignItems: "center", gap: 11, color: "inherit", textDecoration: "none" }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "var(--blue-tint)", color: "var(--blue)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>
            <Icon name="mail" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Newsletter</div>
            <div className="sd-meta">Write and send newsletters, and manage subscribers, on the newsletter site.</div>
          </div>
          <Icon name="chevright" size={18} style={{ color: "var(--ink-3)" }} />
        </a>
      </div>

      {/* Users + masquerade */}
      <div style={{ marginTop: 18 }}>
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
                  <div className="sd-row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flex: "0 0 auto" }}>
                    <button
                      className="sd-btn sd-btn-secondary sd-btn-sm"
                      disabled={busy === `role:${u.id}`}
                      onClick={() => void setAdmin(u.id, !u.isSystemAdmin)}
                    >
                      <Icon name="shield" size={15} />{u.isSystemAdmin ? "Remove admin" : "Make admin"}
                    </button>
                    <button className="sd-btn sd-btn-secondary sd-btn-sm" disabled={busy === u.id} onClick={() => void masquerade(u.id)}>
                      <Icon name="eye" size={15} />Masquerade
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {users.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No users.</div>}
          {usersError && <div className="sd-meta" style={{ padding: "4px 0", color: "var(--warn)" }}>{usersError}</div>}
          <div className="sd-meta" style={{ padding: "8px 0 4px", lineHeight: 1.4 }}>
            Admins get the full console — this list, masquerade, import, and the audit log.
            You can't change your own role; ask another admin.
          </div>
          <CreateUserForm onCreated={loadUsers} />
        </div>
      </div>
    </>
  );

  const auditTab = (
    <div>
      <SectLabel
          action={
            <select className="sd-input" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ height: 30, width: "auto", fontSize: 12.5, padding: "0 8px" }}>
              {ACTION_FILTERS.map((a) => <option key={a} value={a}>{a || "All actions"}</option>)}
            </select>
          }
        >
          Audit log
        </SectLabel>
        <div className="sd-card sd-card-pad" style={{ marginTop: 9, paddingTop: 4, paddingBottom: 4 }}>
          {entries.map((e) => (
            <div key={e.id} className="sd-crow" style={{ alignItems: "center" }}>
              <div className="sd-cicon"><Icon name={iconForAction(e.action)} size={16} /></div>
              <div className="sd-cmain">
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{e.action}</div>
                <div className="sd-meta" style={{ marginTop: 1 }}>
                  {e.actorEmail ?? "system"}
                  {e.masqueradingAsEmail ? ` (as ${e.masqueradingAsEmail})` : ""}
                  {e.entityKind ? ` · ${e.entityKind}` : ""}
                </div>
              </div>
              <div className="sd-meta sd-mono" style={{ flex: "0 0 auto", fontSize: 11 }}>{fmtTime(e.createdAt)}</div>
            </div>
          ))}
          {entries.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No entries.</div>}
          {nextBefore && (
            <button className="sd-btn sd-btn-ghost sd-btn-sm block" style={{ marginTop: 8 }} onClick={() => void loadMore()}>Load more</button>
          )}
        </div>
        <div className="sd-row" style={{ gap: 8, marginTop: 12, padding: "11px 14px", background: "var(--bg-2)", borderRadius: 12, color: "var(--ink-2)", fontSize: 12.5, lineHeight: 1.4 }}>
          <Icon name="info" size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
          The audit log is append-only and hash-chained. Masquerade actions show the admin and the member they acted as.
        </div>
    </div>
  );

  const body = (
    <>
      {tabBar}
      {tab === "users" && usersTab}
      {tab === "audit" && auditTab}
    </>
  );

  if (isDesktop) {
    return <DesktopShell active="admin" title="Admin"><div style={{ maxWidth: 720 }}>{body}</div></DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Admin" onLeft={() => navigate("/")} />
      <div className="sd-scroll"><div className="sd-body">{body}</div></div>
    </AppShell>
  );
}

function iconForAction(action: string): import("../components/Icon.js").IconName {
  if (action.startsWith("masquerade")) return "shield";
  if (action.startsWith("share")) return "lock";
  if (action.startsWith("auth")) return "check";
  if (action.startsWith("contact")) return "phone";
  if (action.startsWith("invite")) return "mail";
  if (action.startsWith("registration")) return "gear";
  if (action.startsWith("notify")) return "mail";
  return "bolt";
}
