// A calendar event's own URL — the content identity behind `/e/:date/:slug`.
//
// An event has no durable public id to put in a URL. `calendar_event.id` is
// re-minted on every re-materialization (CLAUDE.md invariant 8), and the durable
// handle a MANAGED occurrence does have — `(seriesId, recurrenceId)` — is
// deliberately withheld from every public response (invariant 12), because it is
// what volunteer signups key on. Neither is available to a link.
//
// So an event page is addressed the way `dedupeEvents` and `eventKey` already
// address an imported event: by its CONTENT identity — the day it falls on plus
// a slug of its title. The trade is the one invariant 8 already names for
// newsletter event exclusions: retitling or moving an event drops links to the
// old one. That is the strongest thing an ICS feed offers, and taking it here is
// what lets an IMPORTED event have a page at all — a minted slug never could.
//
// This is a URL, not a handle: resolving it is a search (see `findEventByPath`
// in apps/api/src/lib/calendar.ts), and holding one tells you nothing you could
// not already read off the public agenda.

/** Longest slug we mint. Long enough to stay readable, short enough that a
 *  rambling title can't dominate a shared link. */
const MAX_SLUG = 60;

export interface EventPathInput {
  title: string;
  /** ISO-8601 UTC. */
  start: string;
  allDay: boolean;
}

/** Slugify an event title for its URL.
 *
 *  Letters and numbers survive in ANY script (`\p{L}`/`\p{N}`, not `a-z0-9`), so
 *  a title the school wrote in Chinese or Somali keeps its own characters rather
 *  than collapsing to the fallback. Combining marks are folded away first, so
 *  "Día de campo" and "Dia de campo" address the same page.
 *
 *  Both ends of the round trip call this — the app to build a link, the API to
 *  match one — so it must stay deterministic and dependency-free. */
export function eventTitleSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    // Apostrophes close up rather than splitting: "parents' night" → "parents-night".
    .replace(/['\u2018\u2019]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/u, "");
  // A title made entirely of punctuation or emoji still needs a path segment;
  // the date half of the URL is what disambiguates it.
  return slug || "event";
}

/** The `YYYY-MM-DD` half of an event's path.
 *
 *  `timeZone` omitted means the runtime's own zone, which is what the browser
 *  wants: the date in the link matches the day heading the reader tapped. The
 *  API passes SCHOOL_TIMEZONE when it needs to mint the same link server-side.
 *  Either way the lookup searches a ±1 day window, so the two can disagree
 *  about the boundary without breaking the link.
 *
 *  All-day events are read in UTC regardless — they are stored at UTC midnight
 *  and the agenda reads them that way too (`eventDayKey`); resolving one in a
 *  western zone would slide it to the previous day. */
export function eventDateSegment(e: Pick<EventPathInput, "start" | "allDay">, timeZone?: string): string {
  if (e.allDay) return e.start.slice(0, 10);
  // en-CA formats as YYYY-MM-DD, which is the point of choosing it here.
  return new Intl.DateTimeFormat("en-CA", {
    ...(timeZone ? { timeZone } : {}),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(e.start));
}

/** An event's path within the calendar app, e.g. `/e/2026-10-17/fall-carnival`. */
export function eventPath(e: EventPathInput, timeZone?: string): string {
  return `/e/${eventDateSegment(e, timeZone)}/${encodeURIComponent(eventTitleSlug(e.title))}`;
}
