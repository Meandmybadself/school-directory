// What an events block selects: the time window it asks for, and which of the
// returned events the author kept.
//
// This is deliberately separate from newsletterRender.ts. The composer, the
// preview endpoint and the send-time freeze all have to agree on *which events a
// block means*, and only one of the three renders anything. Keeping the
// selection rules pure and in one module is what stops the live preview and the
// mailed issue from disagreeing.

import type { CalendarEventDTO, NewsletterEventsBlockAttrs } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Event identity ──────────────────────────────────────────────────────────

/** A stable handle for "this event", for remembering that an author removed it.
 *
 *  `CalendarEventDTO.id` cannot be used: `calendar_event` is a derived cache and
 *  its rows are re-minted with fresh ULIDs whenever a feed refreshes or a managed
 *  event is edited (invariant 8), so an exclusion keyed on `id` would silently
 *  stop applying and a deleted event would reappear in the sent issue.
 *
 *  A managed occurrence has the durable pair the rest of the system uses. An
 *  imported one has nothing durable at all, so it falls back to the same content
 *  identity `dedupeEvents` already treats as "the same event" — kind, title and
 *  start to the minute. That inherits the same weakness: retitle an imported
 *  event upstream and the exclusion stops matching. It is the strongest handle
 *  an ICS feed actually offers. */
export function eventKey(e: CalendarEventDTO): string {
  if (e.seriesId && e.recurrenceId) return `m:${e.seriesId}:${e.recurrenceId}`;
  return `i:${e.title.trim().toLowerCase()}|${e.start.slice(0, 16)}`;
}

/** The events a block actually shows: everything resolved for its window, minus
 *  what the author removed. Applied at render time rather than at resolve time
 *  so the frozen snapshot keeps the full queried window — the exclusion lives in
 *  the document, which is what a sent issue makes immutable. */
export function visibleEvents(
  attrs: Pick<NewsletterEventsBlockAttrs, "excluded">,
  events: CalendarEventDTO[],
): CalendarEventDTO[] {
  if (attrs.excluded.length === 0) return events;
  const gone = new Set(attrs.excluded);
  return events.filter((e) => !gone.has(eventKey(e)));
}

// ── Time window ─────────────────────────────────────────────────────────────

/** Offset, in ms, between `timeZone` and UTC at a given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some engines render midnight as hour 24 under hour12:false.
  const asIfUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour") % 24,
    at("minute"),
    at("second"),
  );
  return asIfUtc - utcMs;
}

/** The UTC instant at which a calendar date begins in `timeZone`.
 *
 *  An author picking "Aug 1" means midnight where the school is, not midnight
 *  UTC — reading it as UTC is what made all-day events show a day early once
 *  already. Resolved in two passes because the offset in effect at the naive
 *  guess can differ from the one at the answer across a DST boundary. */
export function zonedDayStartUtc(date: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  const first = naive - zoneOffsetMs(naive, timeZone);
  const second = naive - zoneOffsetMs(first, timeZone);
  return new Date(second).toISOString();
}

/** Shift a YYYY-MM-DD by whole days, staying a calendar date. */
export function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** True when the block is pinned to explicit dates rather than a rolling window.
 *  Both ends are required: a half-filled range is treated as still being edited,
 *  and falls back to the lookahead rather than silently querying to forever. */
export function hasFixedRange(
  attrs: Pick<NewsletterEventsBlockAttrs, "rangeStart" | "rangeEnd">,
): boolean {
  return Boolean(attrs.rangeStart && attrs.rangeEnd);
}

/** The `[from, to)` window a block asks the calendar for.
 *
 *  Rolling: `now` to `now + lookaheadDays`, re-evaluated every render, so a draft
 *  edited over several days stays current. Fixed: the author's dates, read in the
 *  school's zone, with `to` pushed to the start of the day AFTER `rangeEnd` so
 *  the last day is included — `queryUpcomingEvents` compares `starts_at < to`. */
export function blockWindow(
  attrs: Pick<
    NewsletterEventsBlockAttrs,
    "lookaheadDays" | "rangeStart" | "rangeEnd"
  >,
  nowIso: string,
  timeZone: string,
): { from: string; to: string } {
  if (hasFixedRange(attrs)) {
    return {
      from: zonedDayStartUtc(attrs.rangeStart!, timeZone),
      to: zonedDayStartUtc(shiftIsoDate(attrs.rangeEnd!, 1), timeZone),
    };
  }
  const fromMs = new Date(nowIso).getTime();
  return {
    from: nowIso,
    to: new Date(fromMs + attrs.lookaheadDays * DAY_MS).toISOString(),
  };
}
