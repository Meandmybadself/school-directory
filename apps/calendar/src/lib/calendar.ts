import type { CalendarEventDTO } from "@sd/shared";

/** The event description is only surfaced for the "Lunch Menu" calendar (the
 *  menu text itself); other calendars keep their descriptions hidden. This gate
 *  is shared across every calendar UI (Calendar screen list + detail, Home
 *  upcoming events) so the rule is defined once. */
export const DESCRIPTION_CALENDAR = "Lunch Menu";

/** True for events on the special "Lunch Menu" calendar, which gets its own
 *  presentation (description surfaced, all-day label suppressed). */
export function isMenuCalendar(e: CalendarEventDTO): boolean {
  return e.source.name === DESCRIPTION_CALENDAR;
}

export function showsDescription(e: CalendarEventDTO): boolean {
  return !!e.description && isMenuCalendar(e);
}

/** The menu feed sets every event's title to the calendar name ("Lunch Menu"),
 *  with the real content in the description — so rendering the title just repeats
 *  the source chip. Hide it in that case; keep it for every other event. */
export function showsTitle(e: CalendarEventDTO): boolean {
  return !(isMenuCalendar(e) && e.title === e.source.name);
}

/** Menu items are inherently all-day, so the "All Day" label is redundant noise
 *  there — hide it. Non-menu all-day events still show it. */
export function showsAllDayLabel(e: CalendarEventDTO): boolean {
  return e.allDay && !isMenuCalendar(e);
}

// ── Which day an event belongs to ────────────────────────────────────────────
//
// An all-day event denotes a calendar DATE, not an instant, and is stored at
// midnight UTC by convention. Reading it with the local-time accessors — as
// `new Date(start).getDate()` does — shifts it to the previous day for every
// viewer west of UTC, so "No School" lands on the wrong day for a school in
// Central Time. All-day values must therefore be read in UTC; timed events are
// real instants and stay local.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Stable "YYYY-MM-DD" key for the day an event belongs on. */
export function eventDayKey(e: CalendarEventDTO): string {
  const d = new Date(e.start);
  if (e.allDay) return d.toISOString().slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Locale-formatted day label for an event, read in the right zone for its kind. */
export function formatEventDay(
  e: CalendarEventDTO,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Date(e.start).toLocaleDateString(locale, {
    ...opts,
    ...(e.allDay ? { timeZone: "UTC" } : {}),
  });
}
