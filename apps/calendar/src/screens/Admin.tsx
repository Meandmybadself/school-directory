// Calendar admin: the calendars we author here, and the ICS feeds we import.
// The imported-feeds section moved here from the directory app's Admin screen.
// Admin chrome is intentionally English-only (operator tooling), matching the
// directory's convention — member-facing copy still goes through i18n.
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import type { CalendarSourceDTO, ManagedCalendarDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel } from "../components/parts.js";
import {
  DEFAULT_COLOR,
  ErrorText,
  IcsLink,
  colorInputStyle,
  fmtTime,
  iconBtnStyle,
} from "../components/adminUi.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";

// ── Imported ICS feeds (moved from the directory app's Admin screen) ─────────

/** A single imported feed: read-only summary, or an inline edit form for its
 *  name / URL / color when the pencil is tapped. */
function SourceRow({ source: s, onSave, onRemove }: {
  source: CalendarSourceDTO;
  onSave: (id: string, patch: { name: string; url: string; color: string }) => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [url, setUrl] = useState(s.url);
  const [color, setColor] = useState(s.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(s.name);
    setUrl(s.url);
    setColor(s.color);
    setError(null);
    setEditing(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !/^https?:\/\//i.test(url.trim())) {
      setError("Enter a name and a valid http(s) URL.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(s.id, { name: name.trim(), url: url.trim(), color });
      setEditing(false);
    } catch {
      setError("Couldn't save — check the URL.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="sd-crow" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        <input className="sd-input" placeholder="Feed name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="sd-input" placeholder="https://…/calendar.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="sd-row" style={{ gap: 8 }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Tag color" style={colorInputStyle} />
          <Btn type="submit" icon="check" disabled={busy || !name.trim() || !url.trim()} style={{ flex: 1 }}>Save</Btn>
          <Btn type="button" kind="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Btn>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </form>
    );
  }
  return (
    <div className="sd-crow" style={{ alignItems: "center", gap: 10 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
        <div className="sd-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.url}</div>
        <div className="sd-meta" style={{ color: s.lastStatus === "error" ? "var(--warn)" : undefined }}>
          {s.lastStatus === "error" ? `⚠ ${s.lastError ?? "fetch failed"}` : `${s.eventCount} events`}
          {s.lastFetchedAt ? ` · ${fmtTime(s.lastFetchedAt)}` : " · never fetched"}
        </div>
      </div>
      <button aria-label="Edit" onClick={startEdit} style={iconBtnStyle}>
        <Icon name="pencil" size={16} />
      </button>
      <button aria-label="Remove" onClick={() => onRemove(s.id)} style={iconBtnStyle}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/** Imported ICS feeds — add/edit/remove sources and trigger a refresh. Events
 *  populate via the cron job; adding a source fetches it immediately. */
function CalendarSourcesSection() {
  const [sources, setSources] = useState<CalendarSourceDTO[]>([]);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
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
  const save = async (id: string, patch: { name: string; url: string; color: string }) => {
    await api.updateCalendarSource(id, patch);
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
    <div>
      <SectLabel action={<Btn sm kind="secondary" onClick={() => void refreshNow()} disabled={busy || sources.length === 0}>Refresh now</Btn>}>
        Imported feeds (ICS)
      </SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {sources.map((s) => (
          <SourceRow key={s.id} source={s} onSave={save} onRemove={remove} />
        ))}
        {sources.length === 0 && <div className="sd-meta" style={{ padding: "8px 0" }}>No imported feeds yet.</div>}
        <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <input className="sd-input" placeholder="Feed name (e.g. School Events)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="sd-input" placeholder="https://…/calendar.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
          <div className="sd-row" style={{ gap: 8 }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Tag color" style={colorInputStyle} />
            <Btn type="submit" icon="plus" disabled={busy || !url.trim() || !name.trim()} style={{ flex: 1 }}>Add feed</Btn>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </div>
    </div>
  );
}

// ── Managed calendars ───────────────────────────────────────────────────────

/** A calendar in the list. The pencil opens the calendar's own page, which is
 *  where both renaming and event management now live — this row no longer edits
 *  anything in place. */
function ManagedCalendarRow({ calendar: c, onRemove }: {
  calendar: ManagedCalendarDTO;
  onRemove: (id: string) => void;
}) {
  const navigate = useNavigate();
  const open = () => navigate(`/admin/calendars/${c.id}`);

  return (
    <div className="sd-crow sd-row" style={{ alignItems: "center", gap: 10 }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flex: "0 0 auto" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sd-row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
          <Tag tone="blue">{c.eventCount} {c.eventCount === 1 ? "event" : "events"}</Tag>
        </div>
        {c.description && <div className="sd-meta">{c.description}</div>}
        <IcsLink url={c.icsUrl} />
      </div>
      <button aria-label={`Edit ${c.name}`} title="Edit calendar" onClick={open} style={iconBtnStyle}>
        <Icon name="pencil" size={16} />
      </button>
      <button aria-label={`Remove ${c.name}`} title="Remove calendar" onClick={() => onRemove(c.id)} style={iconBtnStyle}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/** Calendars authored here. Each publishes its own .ics feed and its events show
 *  in the agenda immediately — there's no fetch cycle to wait for. */
function ManagedCalendarsSection() {
  const [calendars, setCalendars] = useState<ManagedCalendarDTO[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => void api.managedCalendars().then((r) => setCalendars(r.calendars)).catch(() => setCalendars([]));
  useEffect(load, []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addManagedCalendar({ name: name.trim(), color });
      setName("");
      load();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create that calendar."));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    await api.deleteManagedCalendar(id).catch(() => {});
    load();
  };

  return (
    <div>
      <SectLabel>Our calendars</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {calendars.map((c) => (
          <ManagedCalendarRow key={c.id} calendar={c} onRemove={remove} />
        ))}
        {calendars.length === 0 && <div className="sd-meta" style={{ padding: "8px 0" }}>No calendars yet. Create one to start adding events.</div>}
        <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <input className="sd-input" placeholder="Calendar name (e.g. PTA Events)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="sd-row" style={{ gap: 8 }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Tag color" style={colorInputStyle} />
            <Btn type="submit" icon="plus" disabled={busy || !name.trim()} style={{ flex: 1 }}>Create calendar</Btn>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      </div>
    </div>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

export function Admin() {
  const { t } = useI18n();
  const { me, loading } = useSession();
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<"managed" | "imported">("managed");

  if (!loading && me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const tabs: [typeof tab, string][] = [
    ["managed", "Our calendars"],
    ["imported", "Imported feeds"],
  ];

  const body = (
    <>
      <div className="sd-row" style={{ gap: 4, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "9px 12px", background: "none", border: 0, cursor: "pointer", font: "inherit",
              fontSize: 13.5, fontWeight: tab === key ? 800 : 600,
              color: tab === key ? "var(--ink)" : "var(--ink-3)",
              borderBottom: `2px solid ${tab === key ? "var(--blue)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "managed" ? <ManagedCalendarsSection /> : <CalendarSourcesSection />}
    </>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="admin" title="Calendar admin">
        <div style={{ maxWidth: 760, width: "100%" }}>{body}</div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title="Calendar admin" left="shield" right={<span className="sd-meta">{t("brand")}</span>} />
      <div className="sd-scroll">
        <div className="sd-body">{body}</div>
      </div>
    </AppShell>
  );
}
