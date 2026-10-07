// "Add to calendar" for a volunteer spot — what lands in someone's own calendar
// after they take a shift.
//
// Shared because two ends build the same entry: the calendar app mints a Google
// Calendar link in the browser, and the API renders a `.ics` file for everything
// else (Apple, Outlook, any client that imports a file). Both must agree on WHEN
// the shift is, so that rule is written once, here.
//
// This is a COPY of one occurrence, which is the thing the calendar otherwise
// refuses to hand out (an event page has no per-event download — a copied date
// goes stale the moment the school moves it). A volunteer's shift is the
// exception because it is a COMMITMENT the reader made, and their own calendar
// is where commitments live; the agenda subscription can't tell them which of
// the day's slots is theirs. What keeps the copy honest is that it carries the
// event page's URL, so the entry always points back at the version that keeps up,
// and the `.ics` uses the signup's id as its UID, so re-adding it after a move
// replaces the old entry rather than sitting beside it.

/** The fields both sheet shapes (public and member) carry for an event. */
export interface ShiftEventInput {
  start: string;
  end: string | null;
  allDay: boolean;
}

/** The fields a position carries for its optional shift window. */
export interface ShiftPositionInput {
  startsAt: string | null;
  endsAt: string | null;
}

/** When the volunteer is actually needed. ISO-8601 UTC throughout; `end` is
 *  always set, because every calendar wants one. */
export interface ShiftWindow {
  start: string;
  end: string;
  allDay: boolean;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The position's own shift when it has one, else the whole event.
 *
 *  A shift is always timed, even on an all-day event — "the 7:30 setup crew" on
 *  Field Day is a time, not a day. A half-open window is completed from the
 *  event where that makes sense and by an hour where it doesn't: a lone
 *  `startsAt` runs to the event's end, a lone `endsAt` starts with a timed event
 *  (an all-day event's start is UTC midnight, which is no one's start time). */
export function volunteerShiftWindow(event: ShiftEventInput, position: ShiftPositionInput): ShiftWindow {
  const { startsAt, endsAt } = position;
  if (startsAt || endsAt) {
    const timedEnd = !event.allDay ? event.end : null;
    const timedStart = !event.allDay ? event.start : null;
    const startMs = startsAt
      ? Date.parse(startsAt)
      : timedStart && Date.parse(timedStart) < Date.parse(endsAt!)
        ? Date.parse(timedStart)
        : Date.parse(endsAt!) - HOUR;
    let endMs = endsAt ? Date.parse(endsAt) : timedEnd ? Date.parse(timedEnd) : startMs + HOUR;
    if (!(endMs > startMs)) endMs = startMs + HOUR;
    return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), allDay: false };
  }

  const startMs = Date.parse(event.start);
  if (event.allDay) {
    // All-day ends are EXCLUSIVE dates (RFC 5545 §3.6.1), and the event is
    // stored at UTC midnight, so the day after is one UTC day on.
    const endMs = event.end ? Date.parse(event.end) : startMs;
    return {
      start: event.start,
      end: new Date(endMs > startMs ? endMs : startMs + DAY).toISOString(),
      allDay: true,
    };
  }
  const endMs = event.end ? Date.parse(event.end) : startMs + HOUR;
  return {
    start: event.start,
    end: new Date(endMs > startMs ? endMs : startMs + HOUR).toISOString(),
    allDay: false,
  };
}

/** "Volunteer: Setup crew — Fall Carnival". The position leads, because that is
 *  the line in a busy day's calendar that tells the reader what they agreed to. */
export function volunteerEntryTitle(positionTitle: string, eventTitle: string, prefix: string): string {
  return `${prefix}: ${positionTitle} — ${eventTitle}`;
}

/** The entry's notes: the job's description, then the link back to the event
 *  page, which is the version that keeps up when the school moves things. */
export function volunteerEntryDetails(positionDescription: string | null, eventUrl: string | null): string {
  return [positionDescription?.trim(), eventUrl].filter(Boolean).join("\n\n");
}

/** `YYYYMMDD` or `YYYYMMDDTHHMMSSZ`, the form Google's template link and ICS
 *  both take. */
function compactDate(iso: string, allDay: boolean): string {
  const digits = iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  return allDay ? digits.slice(0, 8) : `${digits.slice(0, 8)}T${digits.slice(9, 15)}Z`;
}

/** A Google Calendar "create event" link, pre-filled. Opening it adds nothing
 *  by itself — Google shows the form and the reader saves it. */
export function googleCalendarUrl(entry: {
  title: string;
  window: ShiftWindow;
  location: string | null;
  details: string;
}): string {
  const { window: w } = entry;
  // Assembled by hand rather than with URLSearchParams: this module is also
  // imported by the Worker, whose tsconfig carries no DOM lib.
  const params: Array<[string, string]> = [
    ["action", "TEMPLATE"],
    ["text", entry.title],
    ["dates", `${compactDate(w.start, w.allDay)}/${compactDate(w.end, w.allDay)}`],
  ];
  if (entry.details) params.push(["details", entry.details]);
  if (entry.location) params.push(["location", entry.location]);
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `https://calendar.google.com/calendar/render?${query}`;
}
