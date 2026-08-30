import { htmlToText, type PublicCalendarEventDTO } from "@sd/shared";

/** The calendar whose description IS its content — the menu text itself, with a
 *  title that only repeats the calendar name. See `showsDescription` for when a
 *  description is surfaced generally. */
export const DESCRIPTION_CALENDAR = "Lunch Menu";

/** True for events on the special "Lunch Menu" calendar, which gets its own
 *  presentation (description surfaced, all-day label suppressed). */
export function isMenuCalendar(e: PublicCalendarEventDTO): boolean {
  return e.source.name === DESCRIPTION_CALENDAR;
}

/** Whether a description is worth rendering. Shared across every calendar UI
 *  (Calendar screen list + detail, Home upcoming events) so the rule is defined
 *  once, and consulted by `eventSearchText` so search only matches text the
 *  reader can actually see.
 *
 *  Turns on the SOURCE of the text rather than the calendar it sits on. An
 *  IMPORTED description is whatever the upstream ICS feed put there — vendor
 *  boilerplate, tracking links, the same sentence on every row — which is why
 *  this gate existed at all. A MANAGED one was typed by an admin in this app's
 *  own editor, so hiding it discards the only thing they wrote it for.
 *
 *  The menu calendar stays included on its own terms: it is imported, but its
 *  description is the entire point of the event. */
export function showsDescription(e: PublicCalendarEventDTO): boolean {
  return !!e.description && (e.kind === "managed" || isMenuCalendar(e));
}

/** The menu feed sets every event's title to the calendar name ("Lunch Menu"),
 *  with the real content in the description — so rendering the title just repeats
 *  the source chip. Hide it in that case; keep it for every other event. */
export function showsTitle(e: PublicCalendarEventDTO): boolean {
  return !(isMenuCalendar(e) && e.title === e.source.name);
}

/** Menu items are inherently all-day, so the "All Day" label is redundant noise
 *  there — hide it. Non-menu all-day events still show it. */
export function showsAllDayLabel(e: PublicCalendarEventDTO): boolean {
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
export function eventDayKey(e: PublicCalendarEventDTO): string {
  const d = new Date(e.start);
  if (e.allDay) return d.toISOString().slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Locale-formatted day label for an event, read in the right zone for its kind.
 *
 *  Typed by the two fields it reads rather than by the whole DTO: the event page
 *  labels a volunteer sheet's own occurrence with this when the event it hangs
 *  off no longer resolves, and that occurrence is not an agenda row. */
export function formatEventDay(
  e: Pick<PublicCalendarEventDTO, "start" | "allDay">,
  locale: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  return new Date(e.start).toLocaleDateString(locale, {
    ...opts,
    ...(e.allDay ? { timeZone: "UTC" } : {}),
  });
}

/** Turn a published feed URL into the `webcal:` form.
 *
 *  Purely a scheme swap on OUR OWN origin — `PublicCalendarFeedDTO.url` is
 *  always a feed on this API (invariant 12), never an admin's upstream URL, so
 *  nothing private can be reflected into one of these links.
 *
 *  `webcal:` is what makes this a subscription rather than a download: an https
 *  link hands the calendar app a one-time file, while the same URL under
 *  `webcal:` is registered by Apple Calendar, Outlook and most mobile calendar
 *  apps as "subscribe and keep checking". */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "webcal://");
}

/** Google Calendar's add-by-URL entry point.
 *
 *  Google is the one that needs a special case: it does not register a handler
 *  for `webcal:` in the browser, so a bare webcal link does nothing for the many
 *  families on Google Calendar. `cid` must itself carry the `webcal:` form —
 *  passing https there silently fails to subscribe — and Google's servers fetch
 *  the feed themselves, which is why it only works because /ics/* is public and
 *  unauthenticated by design. */
export function googleSubscribeUrl(url: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(url))}`;
}

// ── As-you-type search ───────────────────────────────────────────────────────
//
// Filtering is entirely client-side: the agenda is already fully loaded (one
// bounded request for the whole window), so there is nothing to gain from a
// round trip per keystroke and nothing to debounce. The matcher lives here
// rather than in the screen so its rules are testable and stated once.

/** Fold a string for comparison: decomposed, stripped of combining marks, and
 *  lowercased — so "Peña" matches a typed "pena" and "PTO" matches "pto". */
export function normalizeSearch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Split a raw query into the terms every match must satisfy. */
export function searchTerms(q: string): string[] {
  return normalizeSearch(q).split(/\s+/).filter(Boolean);
}

/** Everything one event is findable by, already normalized.
 *
 *  Deliberately only what the reader can SEE. The description is included only
 *  when `showsDescription` would render it — matching a menu's text on a
 *  calendar that hides descriptions would return a row with no visible reason
 *  for being there. `dayLabel` is passed in already formatted (the caller owns
 *  the locale) so that typing "friday" or "september" finds the right day. */
export function eventSearchText(e: PublicCalendarEventDTO, dayLabel: string): string {
  const parts = [e.title, e.location ?? "", e.source.name, dayLabel];
  if (showsDescription(e)) parts.push(htmlToText(e.description!));
  return normalizeSearch(parts.join(" "));
}

/** AND across terms, substring within each — so "carnival gym" finds the
 *  carnival in the gym regardless of the order they were typed in, and a
 *  partial word still matches while someone is still typing it. */
export function matchesSearch(haystack: string, terms: string[]): boolean {
  return terms.every((term) => haystack.includes(term));
}
