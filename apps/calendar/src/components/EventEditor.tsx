// The create/edit form for one authored event, including its recurrence. Lives
// in components/ rather than in the screen that grew it because there are now
// two ways in: the calendar's own admin page (screens/CalendarEvents.tsx), and
// the agenda's event modal, where a system admin can edit the event they just
// tapped (screens/Calendar.tsx). One form, so the two can't drift in what a
// recurrence means.
//
// Admin chrome is intentionally English-only (operator tooling), matching the
// directory app's convention — it only ever renders for a system admin.
import { useEffect, useRef, useState } from "react";
import { WEEKDAYS, type Weekday } from "@sd/shared";
import { Btn } from "./atoms.js";
import { Field } from "./parts.js";
import { ErrorText } from "./adminUi.js";
import { errorMessage } from "../lib/api.js";
import { validateForm, type EventForm } from "../lib/eventForm.js";

/** Create/edit form for one authored event, including its recurrence. All the
 *  local-time and all-day conversions live in lib/eventForm.ts. */
export function EventEditor({ initial, busy, onSubmit, onCancel, revealOnMount = true }: {
  initial: EventForm;
  busy: boolean;
  onSubmit: (form: EventForm) => Promise<void>;
  onCancel: () => void;
  /** Scroll the form into view when it opens. Right when the form appears
   *  in-page below a long list; wrong inside a sheet, where the container is
   *  the sheet itself and a form taller than it would open scrolled past its
   *  own heading to the buttons at the bottom. */
  revealOnMount?: boolean;
}) {
  const [f, setF] = useState<EventForm>(initial);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // The form renders below the event list, which on a calendar with more than a
  // few events is well past the fold — so "Add event" just made the button
  // vanish with no visible result. Bring it into view when it opens.
  useEffect(() => {
    if (revealOnMount) formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [revealOnMount]);
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
    <form ref={formRef} onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12, marginTop: 10 }}>
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
