// One managed calendar's events — the page you land on from the admin calendar
// list. Everything that manipulates a calendar's events lives here: the list of
// authored series, and the create/edit form including recurrence.
//
// Admin chrome is intentionally English-only (operator tooling), matching the
// directory app's convention.
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { WEEKDAYS, type ManagedCalendarDTO, type ManagedEventDTO, type Weekday } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, Field } from "../components/parts.js";
import { ErrorText, IcsLink, describeEvent, iconBtnStyle } from "../components/adminUi.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, ApiError, errorMessage } from "../lib/api.js";
import {
  emptyForm,
  formFromEvent,
  toInput,
  validateForm,
  type EventForm,
} from "../lib/eventForm.js";

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

/** Split into what's still coming and what's already happened, so a calendar
 *  with a long history still opens on the events an admin is likely editing.
 *  A recurring series counts as upcoming until its last occurrence has passed —
 *  keying off `recurrence.until` rather than the series' first date, which would
 *  file an active weekly event under "past" the week after it started.
 *  Exported for tests; `now` is injectable so they don't depend on the clock. */
export function partition(
  events: ManagedEventDTO[],
  now: number = Date.now(),
): { upcoming: ManagedEventDTO[]; past: ManagedEventDTO[] } {
  const endOf = (e: ManagedEventDTO) =>
    new Date(e.recurrence?.until ?? e.end ?? e.start).getTime();
  const upcoming: ManagedEventDTO[] = [];
  const past: ManagedEventDTO[] = [];
  for (const e of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    (endOf(e) >= now ? upcoming : past).push(e);
  }
  past.reverse(); // most recently finished first
  return { upcoming, past };
}

function EventRow({ event: e, onEdit, onRemove }: {
  event: ManagedEventDTO;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="sd-crow" style={{ alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sd-row" style={{ gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{e.title}</span>
          {e.recurrence && <Tag tone="blue">{e.occurrenceCount} dates</Tag>}
          {e.allDay && !e.recurrence && <Tag tone="line">All day</Tag>}
        </div>
        <div className="sd-meta">{describeEvent(e)}</div>
        {e.location && <div className="sd-meta">{e.location}</div>}
      </div>
      <button aria-label={`Edit ${e.title}`} onClick={onEdit} style={iconBtnStyle}>
        <Icon name="pencil" size={16} />
      </button>
      <button aria-label={`Remove ${e.title}`} onClick={onRemove} style={iconBtnStyle}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

export function CalendarEvents() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { me, loading: sessionLoading } = useSession();

  const [calendar, setCalendar] = useState<ManagedCalendarDTO | null>(null);
  const [events, setEvents] = useState<ManagedEventDTO[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; form: EventForm } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const loadEvents = () =>
    void api.managedEvents(id).then((r) => setEvents(r.events)).catch(() => setEvents([]));

  useEffect(() => {
    void api
      .managedCalendar(id)
      .then((r) => setCalendar(r.calendar))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
      });
    loadEvents();
  }, [id]);

  const save = async (form: EventForm) => {
    setBusy(true);
    try {
      const body = toInput(form);
      if (editing?.id) await api.updateManagedEvent(editing.id, body);
      else await api.addManagedEvent(id, body);
      setEditing(null);
      loadEvents();
      // The header shows the event count, so refresh the calendar too.
      void api.managedCalendar(id).then((r) => setCalendar(r.calendar)).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const remove = async (eventId: string) => {
    await api.deleteManagedEvent(eventId).catch(() => {});
    loadEvents();
    void api.managedCalendar(id).then((r) => setCalendar(r.calendar)).catch(() => {});
  };

  if (!sessionLoading && me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const { upcoming, past } = partition(events ?? []);
  const title = calendar?.name ?? "Calendar";

  const header = calendar && (
    <div className="sd-card sd-card-pad">
      <div className="sd-row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: calendar.color, flex: "0 0 auto", marginTop: 5 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{calendar.name}</div>
          {calendar.description && <div className="sd-meta">{calendar.description}</div>}
          <IcsLink url={calendar.icsUrl} />
        </div>
      </div>
    </div>
  );

  const list = (
    <>
      <SectLabel
        action={
          !editing && (
            <Btn sm icon="plus" onClick={() => setEditing({ id: null, form: emptyForm() })}>Add event</Btn>
          )
        }
      >
        Events
      </SectLabel>
      <div className="sd-card sd-card-pad" style={{ marginTop: 9 }}>
        {events === null && <div className="sd-meta">Loading events…</div>}
        {events?.length === 0 && !editing && (
          <div className="sd-meta" style={{ padding: "8px 0" }}>
            No events yet. Add one and it appears on the calendar right away.
          </div>
        )}
        {upcoming.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            onEdit={() => setEditing({ id: e.id, form: formFromEvent(e) })}
            onRemove={() => void remove(e.id)}
          />
        ))}

        {past.length > 0 && (
          <>
            <button
              onClick={() => setShowPast((v) => !v)}
              className="sd-row"
              style={{ gap: 5, marginTop: upcoming.length ? 10 : 0, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--blue-700)", font: "inherit", fontSize: 12.5, fontWeight: 700 }}
            >
              <Icon name={showPast ? "chevdown" : "chevright"} size={15} stroke={2.2} />
              {showPast ? "Hide" : "Show"} {past.length} past {past.length === 1 ? "event" : "events"}
            </button>
            {showPast &&
              past.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  onEdit={() => setEditing({ id: e.id, form: formFromEvent(e) })}
                  onRemove={() => void remove(e.id)}
                />
              ))}
          </>
        )}

        {editing && (
          <EventEditor
            key={editing.id ?? "new"}
            initial={editing.form}
            busy={busy}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </>
  );

  const body = missing ? (
    <div className="sd-card sd-card-pad sd-meta" style={{ textAlign: "center", padding: "28px 16px" }}>
      That calendar no longer exists.
      <div style={{ marginTop: 12 }}>
        <Btn kind="secondary" icon="arrowleft" onClick={() => navigate("/admin")}>Back to calendars</Btn>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {header}
      <div>{list}</div>
    </div>
  );

  if (isDesktop) {
    return (
      <DesktopShell active="admin" title={title}>
        <div style={{ maxWidth: 760, width: "100%" }}>
          <button
            onClick={() => navigate("/admin")}
            className="sd-row"
            style={{ gap: 5, marginBottom: 12, background: "none", border: 0, padding: 0, cursor: "pointer", color: "var(--blue-700)", font: "inherit", fontSize: 13, fontWeight: 700 }}
          >
            <Icon name="arrowleft" size={16} stroke={2.2} />Calendars
          </button>
          {body}
        </div>
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title={title} onLeft={() => navigate("/admin")} />
      <div className="sd-scroll">
        <div className="sd-body">{body}</div>
      </div>
    </AppShell>
  );
}
