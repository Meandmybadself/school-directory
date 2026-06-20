// Admin console: registration toggle, masquerade (user list), and the
// append-only audit log. CSV bulk import + co-manager invite UI remain M4.
// Admin chrome is intentionally English-only (operator tooling).
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { AdminUserDTO, AuditEntryDTO, CalendarSourceDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Avatar, Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api } from "../lib/api.js";

const ACTION_FILTERS = [
  "", "auth.signin", "invite.sent", "invite.accepted", "control.granted",
  "masquerade.start", "masquerade.stop", "share.created", "share.revoked",
  "person.updated", "contact.created", "contact.updated", "registration.toggled", "admin.action",
  "calendar.source.created", "calendar.source.deleted", "calendar.refreshed",
];

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** ICS calendar feeds — add/remove sources and trigger a refresh. Events
 *  populate via the cron job; adding a source fetches it immediately. */
function CalendarSourcesSection() {
  const [sources, setSources] = useState<CalendarSourceDTO[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0068A8");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => void api.calendarSources().then((r) => setSources(r.sources)).catch(() => setSources([]));
  useEffect(load, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addCalendarSource({ url: url.trim(), name: name.trim(), color });
      setUrl("");
      setName("");
      load();
    } catch {
      setError("Couldn't add that feed — check the URL.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await api.deleteCalendarSource(id).catch(() => {});
    load();
  };
  const refreshNow = async () => {
    setBusy(true);
    try {
      await api.refreshCalendar();
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 18 }}>
      <SectLabel action={<Btn sm kind="secondary" onClick={() => void refreshNow()} disabled={busy || sources.length === 0}>Refresh now</Btn>}>
        Calendar sources (ICS)
      </SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {sources.map((s) => (
          <div key={s.id} className="sd-crow" style={{ alignItems: "center", gap: 10 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flex: "0 0 auto" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
              <div className="sd-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.url}</div>
              <div className="sd-meta" style={{ color: s.lastStatus === "error" ? "var(--warn)" : undefined }}>
                {s.lastStatus === "error" ? `⚠ ${s.lastError ?? "fetch failed"}` : `${s.eventCount} events`}
                {s.lastFetchedAt ? ` · ${fmtTime(s.lastFetchedAt)}` : " · never fetched"}
              </div>
            </div>
            <button aria-label="Remove" onClick={() => void remove(s.id)} style={{ background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" }}>
              <Icon name="x" size={18} />
            </button>
          </div>
        ))}
        {sources.length === 0 && <div className="sd-meta" style={{ padding: "8px 0" }}>No calendar feeds yet.</div>}
        <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <input className="sd-input" placeholder="Feed name (e.g. School Events)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="sd-input" placeholder="https://…/calendar.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="sd-row" style={{ gap: 8 }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Tag color" style={{ width: 42, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8, background: "none", cursor: "pointer" }} />
            <Btn type="submit" icon="plus" disabled={busy || !url.trim() || !name.trim()} style={{ flex: 1 }}>Add source</Btn>
          </div>
          {error && <div className="sd-meta" style={{ color: "var(--warn)" }}>{error}</div>}
        </form>
      </div>
    </div>
  );
}

export function Admin() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, refresh } = useSession();

  const [users, setUsers] = useState<AdminUserDTO[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [regOpen, setRegOpen] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<AuditEntryDTO[]>([]);
  const [filter, setFilter] = useState("");
  const [nextBefore, setNextBefore] = useState<string | null>(null);

  useEffect(() => {
    void api.adminUsers().then((r) => setUsers(r.users)).catch(() => setUsers([]));
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

  const body = (
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

      {/* Calendar sources */}
      <CalendarSourcesSection />

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
                  <button className="sd-btn sd-btn-secondary sd-btn-sm" disabled={busy === u.id} onClick={() => void masquerade(u.id)}>
                    <Icon name="eye" size={15} />Masquerade
                  </button>
                )}
              </div>
            );
          })}
          {users.length === 0 && <div className="sd-meta" style={{ padding: "12px 0" }}>No users.</div>}
        </div>
      </div>

      {/* Audit log */}
      <div style={{ marginTop: 18 }}>
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
    </>
  );

  if (isDesktop) {
    return <DesktopShell active="admin" title="Admin"><div style={{ maxWidth: 720 }}>{body}</div></DesktopShell>;
  }
  return (
    <AppShell bottomNav={<BottomNav active="me" />}>
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
  return "bolt";
}
