// ICS writer for managed calendars — the counterpart to lib/calendar.ts's
// reader. Pure string generation, no D1 access: a route loads rows and calls
// `renderCalendar`.
//
// This is deliberately the ONLY place a managed event becomes ICS text, because
// lib/managedCalendar.ts materializes occurrences by feeding this output back
// through `parseIcs`. The agenda a member sees and the feed a subscriber pulls
// therefore derive from the same bytes and cannot drift apart.

import type { RecurrenceInput, Weekday } from "@sd/shared";

const PRODID = "-//Eisenhower School Directory//Calendar//EN";
/** RFC 5545 §3.1: content lines are folded at 75 octets. */
const FOLD_AT = 75;

export interface IcsEventInput {
  /** Stable, globally-unique: the managed_event id plus a domain. */
  uid: string;
  title: string;
  location: string | null;
  description: string | null;
  /** ISO-8601 UTC. */
  start: string;
  /** ISO-8601 UTC, or null for an event with no explicit end. */
  end: string | null;
  /** All-day events serialize as VALUE=DATE, per RFC 5545 §3.3.4. */
  allDay: boolean;
  recurrence: RecurrenceInput | null;
  /** RFC 5545 SEQUENCE — bumped on each edit so clients re-pull. */
  sequence: number;
  /** ISO-8601 UTC, becomes DTSTAMP. */
  updatedAt: string;
}

/** Escape a TEXT value: backslash first, then the delimiters, then newlines
 *  (RFC 5545 §3.3.11). CR is dropped rather than escaped — only LF is meaningful. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold one content line to 75 octets, continuing with a leading space.
 *  Measures UTF-8 bytes and never splits a multi-byte character, since the fold
 *  limit is defined in octets but the break must land on a character boundary. */
function foldLine(line: string): string {
  const bytesOf = (s: string): number => new TextEncoder().encode(s).length;
  if (bytesOf(line) <= FOLD_AT) return line;

  const out: string[] = [];
  let current = "";
  // First line allows 75 octets; continuations lose one to the leading space.
  let budget = FOLD_AT;
  for (const char of line) {
    const size = bytesOf(char);
    if (bytesOf(current) + size > budget) {
      out.push(current);
      current = "";
      budget = FOLD_AT - 1;
    }
    current += char;
  }
  if (current) out.push(current);
  return out[0] + out.slice(1).map((seg) => `\r\n ${seg}`).join("");
}

/** `YYYYMMDD` (all-day) or `YYYYMMDDTHHMMSSZ` (timed UTC) from an ISO string. */
export function icsDate(iso: string, allDay: boolean): string {
  const digits = iso.replace(/[-:]/g, "");
  if (allDay) return digits.slice(0, 8);
  return `${digits.slice(0, 8)}T${digits.slice(9, 15)}Z`;
}

/** Render an RRULE value (without the `RRULE:` name). `allDay` matters because
 *  RFC 5545 §3.3.10 requires UNTIL's value type to match DTSTART's.
 *
 *  BYDAY/BYMONTHDAY are emitted explicitly rather than left to a client's
 *  DTSTART-derived default, so every consumer expands the rule identically. */
export function rruleValue(rec: RecurrenceInput, dtstart: string, allDay: boolean): string {
  const parts = [`FREQ=${rec.freq.toUpperCase()}`];
  const interval = rec.interval ?? 1;
  if (interval > 1) parts.push(`INTERVAL=${interval}`);

  if (rec.freq === "weekly") {
    const days: Weekday[] = rec.byDay?.length ? rec.byDay : [weekdayOf(dtstart)];
    parts.push(`BYDAY=${days.join(",")}`);
  } else if (rec.freq === "monthly") {
    // Anchored to the start date's day-of-month. "Nth weekday of the month" is
    // deliberately out of scope.
    parts.push(`BYMONTHDAY=${new Date(dtstart).getUTCDate()}`);
  }

  parts.push(`UNTIL=${icsDate(rec.until, allDay)}`);
  return parts.join(";");
}

const DAY_CODES: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** The ICS weekday code for an ISO timestamp, read in UTC. */
export function weekdayOf(iso: string): Weekday {
  return DAY_CODES[new Date(iso).getUTCDay()]!;
}

function eventLines(e: IcsEventInput): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeText(e.uid)}`,
    `DTSTAMP:${icsDate(e.updatedAt, false)}`,
    `SEQUENCE:${e.sequence}`,
    e.allDay
      ? `DTSTART;VALUE=DATE:${icsDate(e.start, true)}`
      : `DTSTART:${icsDate(e.start, false)}`,
  ];
  if (e.end) {
    lines.push(
      e.allDay ? `DTEND;VALUE=DATE:${icsDate(e.end, true)}` : `DTEND:${icsDate(e.end, false)}`,
    );
  }
  lines.push(`SUMMARY:${escapeText(e.title)}`);
  if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.recurrence) lines.push(`RRULE:${rruleValue(e.recurrence, e.start, e.allDay)}`);
  lines.push("END:VEVENT");
  return lines;
}

/** Render a complete text/calendar document: one VEVENT per event, CRLF line
 *  endings, folded per RFC 5545. */
export function renderCalendar(calendarName: string, events: IcsEventInput[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    ...events.flatMap(eventLines),
    "END:VCALENDAR",
  ];
  // Trailing CRLF: the last content line must be terminated, not merely separated.
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
