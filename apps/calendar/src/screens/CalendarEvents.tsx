// One managed calendar's events — the page you land on from the admin calendar
// list: the list of authored series, plus the create/edit form (which lives in
// components/EventEditor.tsx, shared with the agenda's event modal).
//
// Admin chrome is intentionally English-only (operator tooling), matching the
// directory app's convention.
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { ManagedCalendarDTO, ManagedEventDTO } from "@sd/shared";
import { Icon } from "../components/Icon.js";
import { Btn, Tag } from "../components/atoms.js";
import { AppShell, BottomNav } from "../components/AppShell.js";
import { DesktopShell } from "../components/DesktopShell.js";
import { ScreenHeader, SectLabel, Field, SheetOver } from "../components/parts.js";
import {
  ConfirmDelete,
  ErrorText,
  IcsLink,
  colorInputStyle,
  describeEvent,
  eventDeleteLines,
  iconBtnStyle,
} from "../components/adminUi.js";
import { EventEditor } from "../components/EventEditor.js";
import { useSession } from "../lib/session.js";
import { useIsDesktop } from "../lib/useIsDesktop.js";
import { api, ApiError, errorMessage } from "../lib/api.js";
import { emptyForm, formFromEvent, toInput, type EventForm } from "../lib/eventForm.js";

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

function EventRow({ event: e, onEdit, onRemove, onVolunteers }: {
  event: ManagedEventDTO;
  onEdit: () => void;
  onRemove: () => void;
  onVolunteers: () => void;
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
      {/* Volunteer sheets are per-DATE, so this opens a screen rather than a
          form: a recurring event has one sheet per occurrence to choose from. */}
      <button aria-label={`Volunteers for ${e.title}`} title="Volunteer signups" onClick={onVolunteers} style={iconBtnStyle}>
        <Icon name="members" size={17} />
      </button>
      <button aria-label={`Edit ${e.title}`} onClick={onEdit} style={iconBtnStyle}>
        <Icon name="pencil" size={16} />
      </button>
      <button aria-label={`Remove ${e.title}`} onClick={onRemove} style={iconBtnStyle}>
        <Icon name="x" size={18} />
      </button>
    </div>
  );
}

/** The calendar's own details — name, description, colour — editable in place.
 *  This is the page you land on to work on a calendar, so renaming it belongs
 *  here rather than only in the list it was opened from. */
function CalendarHeader({ calendar: c, onSaved }: {
  calendar: ManagedCalendarDTO;
  onSaved: (next: ManagedCalendarDTO) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [color, setColor] = useState(c.color);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setName(c.name);
    setDescription(c.description ?? "");
    setColor(c.color);
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
      const r = await api.updateManagedCalendar(c.id, {
        name: name.trim(),
        description: description.trim() || null,
        color,
      });
      onSaved(r.calendar);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save that calendar."));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form onSubmit={submit} className="sd-card sd-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Calendar name">
          <input
            className="sd-input"
            placeholder="Calendar name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Description" hint="Optional.">
          <input className="sd-input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Colour">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Calendar colour" style={colorInputStyle} />
        </Field>
        {error && <ErrorText>{error}</ErrorText>}
        <div className="sd-row" style={{ gap: 8 }}>
          <Btn type="submit" icon="check" disabled={busy || !name.trim()} style={{ flex: 1 }}>Save calendar</Btn>
          <Btn type="button" kind="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Btn>
        </div>
      </form>
    );
  }

  return (
    <div className="sd-card sd-card-pad">
      <div className="sd-row" style={{ gap: 10, alignItems: "flex-start" }}>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, flex: "0 0 auto", marginTop: 5 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
          {c.description && <div className="sd-meta">{c.description}</div>}
          <IcsLink url={c.icsUrl} />
        </div>
        <button aria-label="Edit calendar details" title="Edit calendar details" onClick={startEdit} style={iconBtnStyle}>
          <Icon name="pencil" size={16} />
        </button>
      </div>
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
  // The event an admin has asked to delete, held until they confirm it. Deleting
  // takes the whole series, its dates and any volunteer sheet on them, so the
  // one-tap X this used to be was a lot of destruction behind a small target.
  const [removing, setRemoving] = useState<ManagedEventDTO | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
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

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await api.deleteManagedEvent(removing.id);
      // Close the editor if it was open on the event that just went, rather
      // than leaving a form that saves to a 404.
      if (editing?.id === removing.id) setEditing(null);
      setRemoving(null);
      loadEvents();
      // The header shows the event count, so refresh the calendar too.
      void api.managedCalendar(id).then((r) => setCalendar(r.calendar)).catch(() => {});
    } catch (err) {
      setRemoveError(errorMessage(err, "Couldn't delete that event."));
    } finally {
      setBusy(false);
    }
  };

  if (!sessionLoading && me && !me.user.isSystemAdmin) return <Navigate to="/" replace />;

  const { upcoming, past } = partition(events ?? []);
  const title = calendar?.name ?? "Calendar";

  const header = calendar && (
    <CalendarHeader
      calendar={calendar}
      onSaved={(next) => setCalendar(next)}
    />
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
            onRemove={() => { setRemoveError(null); setRemoving(e); }}
            onVolunteers={() => navigate(`/admin/events/${e.id}/volunteers`)}
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
                  onRemove={() => { setRemoveError(null); setRemoving(e); }}
                  onVolunteers={() => navigate(`/admin/events/${e.id}/volunteers`)}
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

  const confirm = removing && (
    <SheetOver onClose={busy ? undefined : () => setRemoving(null)}>
      <ConfirmDelete
        heading={`Delete "${removing.title}"?`}
        lines={eventDeleteLines(removing)}
        confirmLabel="Delete event"
        busy={busy}
        error={removeError}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </SheetOver>
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
        {confirm}
      </DesktopShell>
    );
  }
  return (
    <AppShell bottomNav={<BottomNav active="admin" />}>
      <ScreenHeader title={title} onLeft={() => navigate("/admin")} />
      <div className="sd-scroll">
        <div className="sd-body">{body}</div>
      </div>
      {confirm}
    </AppShell>
  );
}
