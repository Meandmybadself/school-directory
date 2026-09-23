// The school's timezone — the one wall clock every date and time on this site
// is read in.
//
// A calendar event is an INSTANT, and an instant has no day or hour until some
// zone is chosen to read it in. For a long time the browser apps chose the
// READER'S zone, on the assumption that everyone looking at the school's
// calendar is where the school is. That holds until a parent travels, or an
// admin in another zone enters an event: then "5:30 PM" typed in Denver is
// stored as 6:30 PM here, and the carnival moves an hour without anyone
// editing it. So there is one zone, it is a property of where the school IS,
// and it is configured per instance:
//
//   · the API Worker reads `SCHOOL_TIMEZONE` (apps/api/wrangler.toml);
//   · the calendar SPA reads `VITE_SCHOOL_TIMEZONE` at build time;
//   · anything with neither falls back to `DEFAULT_TIME_ZONE` below.
//
// All three must name the same zone, which is why the default lives here, once,
// rather than as a literal in each app. Every value goes through
// `resolveTimeZone`, so a typo in configuration degrades to the default rather
// than throwing a RangeError out of every date on the page.
//
// All-day events are NOT read in this zone. They denote a calendar DATE, stored
// at midnight UTC by convention, and are read in UTC everywhere — see
// `eventDayKey` in the calendar app and `eventDateSegment` in eventPath.ts.

/** The zone this instance falls back to when nothing configures one. */
export const DEFAULT_TIME_ZONE = "America/Chicago";

/** True if `tz` names an IANA zone this runtime knows. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A configured zone, or the default when it is missing or not a real zone. */
export function resolveTimeZone(configured: string | null | undefined): string {
  const tz = configured?.trim();
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockAt(utcMs: number, timeZone: string): WallClock {
  // CLOCK-EXEMPT: this PARSES a wall clock out of `formatToParts` as numbers;
  // nothing here is shown to anyone. `hourCycle: "h23"` is what makes the hour
  // a value that can be subtracted — a 12-hour cycle would halve every afternoon.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: at("year"),
    month: at("month"),
    day: at("day"),
    // Some engines render midnight as hour 24 even under h23.
    hour: at("hour") % 24,
    minute: at("minute"),
    second: at("second"),
  };
}

/** Offset, in ms, between `timeZone` and UTC at a given instant. */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const w = wallClockAt(utcMs, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - utcMs;
}

/** The UTC instant of a wall-clock reading in `timeZone`.
 *
 *  Two passes, because the offset in effect at the naive guess can differ from
 *  the one at the answer across a DST boundary. A wall time that does not exist
 *  (2:30 AM on spring-forward day) lands an hour later; one that happens twice
 *  (1:30 AM on fall-back day) takes the first. */
export function zonedWallClockToUtcMs(
  date: string,
  time: string,
  timeZone: string,
): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "00:00").split(":").map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const first = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(first, timeZone);
}

/** `yyyy-mm-dd` + `HH:mm` read in `timeZone`, as an ISO-8601 UTC string. */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  return new Date(zonedWallClockToUtcMs(date, time, timeZone)).toISOString();
}

/** The calendar date of an instant in `timeZone`, as `yyyy-mm-dd`. */
export function isoToZonedDate(iso: string, timeZone: string): string {
  const w = wallClockAt(new Date(iso).getTime(), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** The wall-clock time of an instant in `timeZone`, as 24-hour `HH:mm` — the
 *  serialized form `<input type="time">` takes, never a display string. */
export function isoToZonedTime(iso: string, timeZone: string): string {
  const w = wallClockAt(new Date(iso).getTime(), timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}
