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
