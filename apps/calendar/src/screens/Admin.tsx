// Calendar admin: the calendars we author here, and the ICS feeds we import.
// The imported-feeds section moved here from the directory app's Admin screen.
// Admin chrome is intentionally English-only (operator tooling), matching the
// directory's convention — member-facing copy still goes through i18n.
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { WEEKDAYS, type CalendarSourceDTO, type ManagedCalendarDTO, type ManagedEventDTO, type Weekday } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, Field } from "../components/parts.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, errorMessage } from "../lib/api.js";
import { useI18n } from "../i18n/index.js";
import {
  emptyForm,
  formFromEvent,
  toInput,
  validateForm,
  type EventForm,
} from "../lib/eventForm.js";

const DEFAULT_COLOR = "#0068A8";

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/** A human summary of an event's schedule, for the admin list. */
function describeEvent(e: ManagedEventDTO): string {
  const start = new Date(e.start);
  const date = e.allDay
    ? start.toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
    : start.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  if (!e.recurrence) return e.allDay ? `${date} · all day` : date;

  const { freq, interval = 1, byDay, until } = e.recurrence;
  const every = interval > 1 ? `every ${interval} ${freq === "daily" ? "days" : freq === "weekly" ? "weeks" : "months"}` : freq;
  const days = freq === "weekly" && byDay?.length ? ` on ${byDay.join(", ")}` : "";
  const untilLabel = new Date(until).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  return `${date} · ${every}${days} until ${untilLabel}`;
}

const colorInputStyle = {
  width: 42, height: 38, padding: 0, border: "1px solid var(--line)", borderRadius: 8,
  background: "none", cursor: "pointer",
} as const;

const iconBtnStyle = { background: "none", border: 0, color: "var(--ink-3)", cursor: "pointer" } as const;

function ErrorText({ children }: { children: React.ReactNode }) {
  return <div className="sd-meta" style={{ color: "var(--warn)" }}>{children}</div>;
}

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

// ── Managed events ──────────────────────────────────────────────────────────

/** Create/edit form for one authored event, including its recurrence. All the
 *  local-time and all-day conversions live in lib/eventForm.ts. */
function EventEditor({ initial, busy, onSubmit, onCancel }: {
  initial: EventForm;
  busy: boolean;
  onSubmit: (form: EventForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState<EventForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setF((cur) => ({ ...cur, [key]: value }));

  const toggleDay = (d: Weekday) =>
    setF((cur) => ({
      ...cur,
      byDay: cur.byDay.includes(d) ? cur.byDay.filter((x) => x !== d) : [...cur.byDay, d],
    }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateForm(f);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await onSubmit(f);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that event."));
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 10 }}>
      <Field label="Title">
        <input className="sd-input" placeholder="Fall Carnival" value={f.title} onChange={(e) => set("title", e.target.value)} />
      </Field>

      <label className="sd-row" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={f.allDay} onChange={(e) => set("allDay", e.target.checked)} />
        <span style={{ fontSize: 14, fontWeight: 600 }}>All day</span>
      </label>

      {f.allDay ? (
        <div className="sd-row" style={{ gap: 8, alignItems: "flex-end" }}>
          <Field label="First day">
            <input className="sd-input" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <Field label="Last day" hint="Same as the first for a one-day event.">
            <input className="sd-input" type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
          </Field>
        </div>
      ) : (
        <>
          <Field label="Date">
            <input className="sd-input" type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
          </Field>
          <div className="sd-row" style={{ gap: 8, alignItems: "flex-end" }}>
            <Field label="Starts">
              <input className="sd-input" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} />
            </Field>
            <Field label="Ends" hint="Optional.">
              <input className="sd-input" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} />
            </Field>
          </div>
        </>
      )}

      <Field label="Location">
        <input className="sd-input" placeholder="Gym" value={f.location} onChange={(e) => set("location", e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea className="sd-input" rows={3} style={{ height: "auto", resize: "vertical" }} value={f.description} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <Field label="Repeat">
        <select className="sd-input" value={f.repeat} onChange={(e) => set("repeat", e.target.value as EventForm["repeat"])}>
          <option value="none">Doesn't repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </Field>

      {f.repeat !== "none" && (
        <>
          <div className="sd-row" style={{ gap: 8, alignItems: "flex-end" }}>
            <Field label="Every">
              <input className="sd-input" type="number" min={1} value={f.interval} onChange={(e) => set("interval", e.target.value)} style={{ width: 80 }} />
            </Field>
            <div className="sd-meta" style={{ paddingBottom: 11 }}>
              {f.repeat === "daily" ? "day(s)" : f.repeat === "weekly" ? "week(s)" : "month(s)"}
            </div>
          </div>

          {f.repeat === "weekly" && (
            <Field label="On these days">
              <div className="sd-row" style={{ gap: 6, flexWrap: "wrap" }}>
                {WEEKDAYS.map((d) => {
                  const on = f.byDay.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      aria-pressed={on}
                      style={{
                        padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${on ? "var(--blue)" : "var(--line)"}`,
                        background: on ? "var(--blue-tint)" : "var(--paper)",
                        color: on ? "var(--blue-800)" : "var(--ink-2)",
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {f.repeat === "monthly" && (
            <div className="sd-meta">Repeats on day {Number(f.startDate.slice(8, 10))} of the month.</div>
          )}

          <Field label="Repeat until" hint="Required — every repeating event needs an end date.">
            <input className="sd-input" type="date" value={f.untilDate} onChange={(e) => set("untilDate", e.target.value)} />
          </Field>
        </>
      )}

      {error && <ErrorText>{error}</ErrorText>}
      <div className="sd-row" style={{ gap: 8 }}>
        <Btn type="submit" icon="check" disabled={busy} style={{ flex: 1 }}>Save event</Btn>
        <Btn type="button" kind="secondary" onClick={onCancel} disabled={busy}>Cancel</Btn>
      </div>
    </form>
  );
}

/** The event list for one managed calendar, with inline create/edit. */
function EventList({ calendarId, onChanged }: { calendarId: string; onChanged: () => void }) {
  const [events, setEvents] = useState<ManagedEventDTO[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: EventForm } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => void api.managedEvents(calendarId).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  useEffect(load, [calendarId]);

  const save = async (form: EventForm) => {
    setBusy(true);
    try {
      const body = toInput(form);
      if (editing?.id) await api.updateManagedEvent(editing.id, body);
      else await api.addManagedEvent(calendarId, body);
      setEditing(null);
      load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteManagedEvent(id).catch(() => {});
    load();
    onChanged();
  };

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      {events === null && <div className="sd-meta">Loading events…</div>}
      {events?.length === 0 && <div className="sd-meta">No events on this calendar yet.</div>}
      {events?.map((e) => (
        <div key={e.id} className="sd-crow" style={{ alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</div>
            <div className="sd-meta">{describeEvent(e)}</div>
            {e.recurrence && <div className="sd-meta">{e.occurrenceCount} dates</div>}
          </div>
          <button aria-label="Edit" onClick={() => setEditing({ id: e.id, form: formFromEvent(e) })} style={iconBtnStyle}>
            <Icon name="pencil" size={16} />
          </button>
          <button aria-label="Remove" onClick={() => void remove(e.id)} style={iconBtnStyle}>
            <Icon name="x" size={18} />
          </button>
        </div>
      ))}

      {editing ? (
        <EventEditor
          key={editing.id ?? "new"}
          initial={editing.form}
          busy={busy}
          onSubmit={save}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Btn sm kind="secondary" icon="plus" style={{ marginTop: 10 }} onClick={() => setEditing({ id: null, form: emptyForm() })}>
          Add event
        </Btn>
      )}
    </div>
  );
}

// ── Managed calendars ───────────────────────────────────────────────────────

/** The published .ics URL, with a copy button — this is what an admin hands to
 *  someone who wants to subscribe from Google or Apple Calendar. */
function IcsLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the link is still selectable */
    }
  };
  return (
    <div className="sd-row" style={{ gap: 6, marginTop: 4 }}>
      <a href={url} target="_blank" rel="noopener noreferrer" className="sd-meta sd-link" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {url}
      </a>
      <button aria-label="Copy feed URL" onClick={() => void copy()} style={{ ...iconBtnStyle, flex: "0 0 auto" }}>
        <Icon name={copied ? "check" : "link"} size={15} />
      </button>
    </div>
  );
}

function ManagedCalendarRow({ calendar: c, onSave, onRemove, onChanged }: {
  calendar: ManagedCalendarDTO;
  onSave: (id: string, patch: { name: string; color: string; description: string | null }) => Promise<void>;
  onRemove: (id: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [name, setName] = useState(c.name);
  const [color, setColor] = useState(c.color);
  const [description, setDescription] = useState(c.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(c.name);
    setColor(c.color);
    setDescription(c.description ?? "");
    setError(null);
    setEditing(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(c.id, { name: name.trim(), color, description: description.trim() || null });
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that calendar."));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="sd-crow" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
        <input className="sd-input" placeholder="Calendar name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="sd-input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="sd-row" style={{ gap: 8 }}>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Tag color" style={colorInputStyle} />
          <Btn type="submit" icon="check" disabled={busy || !name.trim()} style={{ flex: 1 }}>Save</Btn>
          <Btn type="button" kind="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Btn>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
      </form>
    );
  }

  return (
    <div className="sd-crow" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
      <div className="sd-row" style={{ alignItems: "center", gap: 10 }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flex: "0 0 auto" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sd-row" style={{ gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</span>
            <Tag tone="blue">{c.eventCount} {c.eventCount === 1 ? "event" : "events"}</Tag>
          </div>
          {c.description && <div className="sd-meta">{c.description}</div>}
          <IcsLink url={c.icsUrl} />
        </div>
        <button aria-label="Edit" onClick={startEdit} style={iconBtnStyle}>
          <Icon name="pencil" size={16} />
        </button>
        <button aria-label="Remove" onClick={() => onRemove(c.id)} style={iconBtnStyle}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <button
        onClick={() => setShowEvents((v) => !v)}
        className="sd-row"
        style={{ gap: 5, marginTop: 8, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--blue-700)", font: "inherit", fontSize: 12.5, fontWeight: 700 }}
      >
        <Icon name={showEvents ? "chevdown" : "chevright"} size={15} stroke={2.2} />
        {showEvents ? "Hide events" : "Manage events"}
      </button>
      {showEvents && <EventList calendarId={c.id} onChanged={onChanged} />}
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
  const save = async (id: string, patch: { name: string; color: string; description: string | null }) => {
    await api.updateManagedCalendar(id, patch);
    load();
  };

  return (
    <div>
      <SectLabel>Our calendars</SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {calendars.map((c) => (
          <ManagedCalendarRow key={c.id} calendar={c} onSave={save} onRemove={remove} onChanged={load} />
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
