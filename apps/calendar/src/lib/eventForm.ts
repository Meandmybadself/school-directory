// Conversion between the event form's inputs and the API's ManagedEventInput.
//
// Two conventions have to be respected, and getting either wrong is a
// silently-off-by-hours or off-by-a-day bug:
//
//  1. Timed events are wall-clock. `<input type="datetime-local">` gives the
//     admin's local time; the API stores a UTC instant. There is no school
//     timezone setting anywhere in this system — the whole app assumes the
//     viewer's local zone is the school's — so "local time in the admin's
//     browser" is the definition of the event's time.
//  2. All-day events are dates, not instants. They are stored as midnight UTC so
//     the stored day matches the day that was picked regardless of who reads it,
//     and their end is the RFC 5545 *exclusive* day-after-the-last-day. Admins
//     pick the inclusive last day, so the +1/-1 day conversion happens here and
//     never leaks into the UI.

import type { ManagedEventDTO, ManagedEventInput, RecurFreq, Weekday } from "@sd/shared";

export interface EventForm {
  title: string;
  location: string;
  description: string;
  allDay: boolean;
  /** yyyy-mm-dd */
  startDate: string;
  /** HH:mm — timed events only. */
  startTime: string;
  /** yyyy-mm-dd. Timed: same-day end. All-day: the INCLUSIVE last day. */
  endDate: string;
  /** HH:mm — timed events only. Empty means "no end". */
  endTime: string;
  repeat: "none" | RecurFreq;
  interval: string;
  byDay: Weekday[];
  /** yyyy-mm-dd — the last day the event may repeat on, inclusive. */
  untilDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** yyyy-mm-dd + HH:mm, read as the browser's local time, as a UTC ISO string. */
export function localToIso(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  // The multi-arg Date constructor interprets its arguments as local time, which
  // is exactly the wall-clock semantics we want.
  return new Date(y!, m! - 1, d!, hh!, mm!, 0, 0).toISOString();
}

/** yyyy-mm-dd as midnight UTC — the storage form for an all-day boundary. */
export function dateToIso(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** The UTC calendar date of an ISO instant, as yyyy-mm-dd. For all-day values,
 *  which are stored at midnight UTC, this round-trips the day exactly. */
export function isoToUtcDate(iso: string): string {
  return iso.slice(0, 10);
}

/** The local calendar date of an ISO instant, as yyyy-mm-dd — for timed events,
 *  whose form inputs are local. */
export function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local wall-clock time of an ISO instant, as HH:mm. */
export function isoToLocalTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Shift a yyyy-mm-dd by whole days, staying in UTC so no DST transition can
 *  move the result onto a neighbouring day. */
export function shiftDate(date: string, days: number): string {
  return new Date(new Date(dateToIso(date)).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** UNTIL for a recurrence, from the inclusive last day the admin picked.
 *
 *  All-day: midnight UTC of that day, so the emitted DATE-typed UNTIL is that day.
 *  Timed: the local END of that day, so an occurrence late in the evening still
 *  falls on or before UNTIL — using midnight would silently drop the last one for
 *  any event whose UTC instant lands on the following day. */
export function untilToIso(date: string, allDay: boolean): string {
  if (allDay) return dateToIso(date);
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).toISOString();
}

/** Blank form, defaulting to the next whole hour today. */
export function emptyForm(): EventForm {
  const now = new Date();
  const date = isoToLocalDate(now.toISOString());
  const hour = pad(Math.min(now.getHours() + 1, 23));
  return {
    title: "",
    location: "",
    description: "",
    allDay: false,
    startDate: date,
    startTime: `${hour}:00`,
    endDate: date,
    endTime: "",
    repeat: "none",
    interval: "1",
    byDay: [],
    untilDate: shiftDate(date, 30),
  };
}

/** Populate the form from an existing event, undoing the storage conventions. */
export function formFromEvent(e: ManagedEventDTO): EventForm {
  const base = emptyForm();
  const allDay = e.allDay;
  const startDate = allDay ? isoToUtcDate(e.start) : isoToLocalDate(e.start);
  // All-day ends are stored exclusive; show the inclusive last day.
  const endDate = e.end
    ? allDay
      ? shiftDate(isoToUtcDate(e.end), -1)
      : isoToLocalDate(e.end)
    : startDate;

  return {
    ...base,
    title: e.title,
    location: e.location ?? "",
    description: e.description ?? "",
    allDay,
    startDate,
    startTime: allDay ? base.startTime : isoToLocalTime(e.start),
    endDate,
    endTime: !allDay && e.end ? isoToLocalTime(e.end) : "",
    repeat: e.recurrence?.freq ?? "none",
    interval: String(e.recurrence?.interval ?? 1),
    byDay: e.recurrence?.byDay ?? [],
    untilDate: e.recurrence
      ? allDay
        ? isoToUtcDate(e.recurrence.until)
        : isoToLocalDate(e.recurrence.until)
      : base.untilDate,
  };
}

/** Local, user-facing validation. The API validates again — this exists so the
 *  common mistakes get an answer without a round trip. */
export function validateForm(f: EventForm): string | null {
  if (!f.title.trim()) return "Give the event a title.";
  if (!f.startDate) return "Pick a start date.";
  if (!f.allDay && !f.startTime) return "Pick a start time.";
  if (f.allDay && f.endDate && f.endDate < f.startDate) return "The last day can't be before the first.";
  if (f.repeat !== "none") {
    if (!f.untilDate) return "Pick the date the repeat ends.";
    if (f.untilDate < f.startDate) return "The repeat has to end on or after the start.";
    const n = Number(f.interval);
    if (!Number.isInteger(n) || n < 1) return "Repeat every N must be a whole number of 1 or more.";
    if (f.repeat === "weekly" && f.byDay.length === 0) return "Pick at least one weekday to repeat on.";
  }
  return null;
}

/** Build the API payload. Assumes `validateForm` already passed. */
export function toInput(f: EventForm): ManagedEventInput {
  const allDay = f.allDay;
  const start = allDay ? dateToIso(f.startDate) : localToIso(f.startDate, f.startTime);

  let end: string | null = null;
  if (allDay) {
    // Exclusive: the day after the inclusive last day (a single-day event ends
    // the following midnight).
    end = dateToIso(shiftDate(f.endDate || f.startDate, 1));
  } else if (f.endTime) {
    end = localToIso(f.endDate || f.startDate, f.endTime);
  }

  return {
    title: f.title.trim(),
    location: f.location.trim() || null,
    description: f.description.trim() || null,
    start,
    end,
    allDay,
    recurrence:
      f.repeat === "none"
        ? null
        : {
            freq: f.repeat,
            interval: Number(f.interval) || 1,
            ...(f.repeat === "weekly" ? { byDay: f.byDay } : {}),
            until: untilToIso(f.untilDate, allDay),
          },
  };
}
