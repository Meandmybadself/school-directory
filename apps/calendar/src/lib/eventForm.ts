// Conversion between the event form's inputs and the API's ManagedEventInput.
//
// Two conventions have to be respected, and getting either wrong is a
// silently-off-by-hours or off-by-a-day bug:
//
//  1. Timed events are wall-clock IN THE SCHOOL'S ZONE (`SCHOOL_TIME_ZONE`,
//     lib/timezone.ts). The date and time inputs give the time as it reads
//     where the school is; the API stores a UTC instant. The admin's own
//     browser zone plays no part: an admin entering "5:30 PM" while
//     travelling means 5:30 PM at the school, and that is what is stored.
//  2. All-day events are dates, not instants. They are stored as midnight UTC so
//     the stored day matches the day that was picked regardless of who reads it,
//     and their end is the RFC 5545 *exclusive* day-after-the-last-day. Admins
//     pick the inclusive last day, so the +1/-1 day conversion happens here and
//     never leaks into the UI.

import {
  isoToZonedDate,
  isoToZonedTime,
  zonedToIso,
  type ManagedEventDTO,
  type ManagedEventInput,
  type RecurFreq,
  type Weekday,
} from "@sd/shared";
import { SCHOOL_TIME_ZONE } from "./timezone.js";

export interface EventForm {
  title: string;
  location: string;
  description: string;
  /** Online meeting link. Empty means none; otherwise must parse as http(s). */
  meetingUrl: string;
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

/** yyyy-mm-dd + HH:mm, read as the school's wall clock, as a UTC ISO string. */
export function schoolToIso(date: string, time: string, timeZone: string = SCHOOL_TIME_ZONE): string {
  return zonedToIso(date, time, timeZone);
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

/** The school's calendar date of an ISO instant, as yyyy-mm-dd — for timed
 *  events, whose form inputs are in the school's zone. */
export function isoToSchoolDate(iso: string, timeZone: string = SCHOOL_TIME_ZONE): string {
  return isoToZonedDate(iso, timeZone);
}

/** The school's wall-clock time of an ISO instant, as HH:mm. */
export function isoToSchoolTime(iso: string, timeZone: string = SCHOOL_TIME_ZONE): string {
  return isoToZonedTime(iso, timeZone);
}

/** Shift a yyyy-mm-dd by whole days, staying in UTC so no DST transition can
 *  move the result onto a neighbouring day. */
export function shiftDate(date: string, days: number): string {
  return new Date(new Date(dateToIso(date)).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** UNTIL for a recurrence, from the inclusive last day the admin picked.
 *
 *  All-day: midnight UTC of that day, so the emitted DATE-typed UNTIL is that day.
 *  Timed: the END of that day at the school, so an occurrence late in the
 *  evening still falls on or before UNTIL — using midnight would silently drop
 *  the last one for any event whose UTC instant lands on the following day. */
export function untilToIso(date: string, allDay: boolean, timeZone: string = SCHOOL_TIME_ZONE): string {
  if (allDay) return dateToIso(date);
  // The last millisecond before the next day begins at the school.
  return new Date(new Date(zonedToIso(shiftDate(date, 1), "00:00", timeZone)).getTime() - 1).toISOString();
}

/** Blank form, defaulting to the next whole hour today, at the school. */
export function emptyForm(now: Date = new Date()): EventForm {
  const iso = now.toISOString();
  const date = isoToSchoolDate(iso);
  const hour = pad(Math.min(Number(isoToSchoolTime(iso).slice(0, 2)) + 1, 23));
  return {
    title: "",
    location: "",
    description: "",
    meetingUrl: "",
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
  const startDate = allDay ? isoToUtcDate(e.start) : isoToSchoolDate(e.start);
  // All-day ends are stored exclusive; show the inclusive last day.
  const endDate = e.end
    ? allDay
      ? shiftDate(isoToUtcDate(e.end), -1)
      : isoToSchoolDate(e.end)
    : startDate;

  return {
    ...base,
    title: e.title,
    location: e.location ?? "",
    description: e.description ?? "",
    meetingUrl: e.meetingUrl ?? "",
    allDay,
    startDate,
    startTime: allDay ? base.startTime : isoToSchoolTime(e.start),
    endDate,
    endTime: !allDay && e.end ? isoToSchoolTime(e.end) : "",
    repeat: e.recurrence?.freq ?? "none",
    interval: String(e.recurrence?.interval ?? 1),
    byDay: e.recurrence?.byDay ?? [],
    untilDate: e.recurrence
      ? allDay
        ? isoToUtcDate(e.recurrence.until)
        : isoToSchoolDate(e.recurrence.until)
      : base.untilDate,
  };
}

/** Does this read as a web address? Mirrors the API's rule (http(s) via
 *  `new URL()`), so the common paste mistake — a bare `meet.google.com/…`
 *  with no scheme — is caught before the round trip. */
export function isMeetingUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** Local, user-facing validation. The API validates again — this exists so the
 *  common mistakes get an answer without a round trip. */
export function validateForm(f: EventForm): string | null {
  if (!f.title.trim()) return "Give the event a title.";
  if (f.meetingUrl.trim() && !isMeetingUrl(f.meetingUrl.trim())) {
    return "The online meeting link needs to be a full web address, starting with https://.";
  }
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
  const start = allDay ? dateToIso(f.startDate) : schoolToIso(f.startDate, f.startTime);

  let end: string | null = null;
  if (allDay) {
    // Exclusive: the day after the inclusive last day (a single-day event ends
    // the following midnight).
    end = dateToIso(shiftDate(f.endDate || f.startDate, 1));
  } else if (f.endTime) {
    // A timed event's end belongs to the START's day, never to `f.endDate`.
    // The timed editor shows ONE date input (bound to `startDate`) plus two
    // times — there is no end-date field to change — but `formFromEvent` still
    // fills `endDate` from the event being edited. Reading it here meant that
    // moving an existing event's date sent the NEW start with the OLD end, and
    // the API answered "End must be on or after the start." for every date
    // change on a timed event. `endDate` stays in the form because the all-day
    // branch above genuinely uses it.
    end = schoolToIso(f.startDate, f.endTime);
    // An end at or before the start on the same day is how a single date field
    // has to express an event running past local midnight (21:00–01:00), which
    // is the one case the old `endDate` was carrying correctly. Equal times stay
    // a zero-length event rather than becoming a 24-hour one.
    if (new Date(end).getTime() < new Date(start).getTime()) {
      end = schoolToIso(shiftDate(f.startDate, 1), f.endTime);
    }
  }

  return {
    title: f.title.trim(),
    location: f.location.trim() || null,
    description: f.description.trim() || null,
    meetingUrl: f.meetingUrl.trim() || null,
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
