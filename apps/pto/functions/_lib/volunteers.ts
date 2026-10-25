// The subrequests the landing page makes: which upcoming events still need
// hands.
//
// This file is the decision ROUTING.md said would have to be re-made
// deliberately — for a long time NO Function on this origin read anything.
// /how-to-help took the read on because answering "where am I needed?" with a
// hand-maintained copy is wrong within the week; when that page merged into
// the landing page, the read moved with its block. /resource-center still
// reads nothing at all.
//
// It is apps/home's `events.ts` with the calendar app's /volunteers assembly
// folded in (that screen moved here and was retired), and it keeps all three
// of that file's properties:
//
//  - **Anonymous routes only.** `/calendar-public/events` is `publicEventOf`
//    (invariant 12) and `/volunteers-public/sheets/:slug` is `publicSheetOf`
//    (invariant 13): counts, never names. This page is indexed, so it must
//    never call the members-only twins, no matter that a Function could.
//  - **It can never take the page down.** A timeout, a non-200, a wrong shape
//    and an unset API_BASE all resolve to `null`, which hides the block; the
//    page still renders everything else. `null` (could not ask) is kept
//    distinct from `[]` (asked, and every spot is taken) so the page never
//    claims "all covered" on an outage.
//  - **The subrequests are edge-cached.** A couple of minutes of staleness on
//    a count is invisible; a fan-out per reader is not.
//
// The per-sheet fan-out is the calendar screen's own trade, inherited with the
// assembly: at a school's scale the window holds a handful of published
// sheets, and reusing the public per-sheet route means nothing new had to
// clear invariant 13's bar. A sheet that 404s or times out drops its row
// rather than failing the list — this is an index, and the event page is the
// authority.

import type { PublicCalendarEventDTO, PublicVolunteerSheetDTO } from "@sd/shared";

/** The two vars wrangler.toml declares. Optional on the type because absent
 *  must mean "block hidden", never a 500 — the contract every optional
 *  secret/binding in this project has. */
export interface PagesEnv {
  API_BASE?: string;
  SCHOOL_TIMEZONE?: string;
}

export interface OpenSheetRow {
  event: PublicCalendarEventDTO;
  /** Open spots summed across the sheet's positions — what makes a row a row. */
  left: number;
}

/** A slow API must not hold this page open; the block just doesn't render. */
const TIMEOUT_MS = 1500;

/** Short, because this block's one number is "how many spots are LEFT" and a
 *  reader acts on it; long enough that most readers are served from the edge. */
const EVENTS_CACHE_S = 120;
const SHEET_CACHE_S = 60;

/** How many sheets the fan-out will ask about, and how many rows render. More
 *  open sheets than this at once has never happened here; the calendar still
 *  shows every event either way. */
const MAX_SHEETS = 12;
const ROW_LIMIT = 8;

/** Events in the public window whose published sheet still accepts claims and
 *  still has an open spot, soonest first. `null` means the question could not
 *  be asked (hide the block); `[]` means it was asked and everything is taken. */
export async function openVolunteerEvents(env: PagesEnv): Promise<OpenSheetRow[] | null> {
  const base = env.API_BASE?.replace(/\/$/, "");
  if (!base) return null;

  let events: PublicCalendarEventDTO[];
  try {
    const res = await fetch(`${base}/calendar-public/events?limit=200`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cf: { cacheTtl: EVENTS_CACHE_S, cacheEverything: true },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { events?: unknown };
    if (!Array.isArray(body.events)) return null;
    events = (body.events as PublicCalendarEventDTO[]).filter(isEvent);
  } catch {
    return null;
  }

  // One row per sheet. A slug can only repeat if syndication duplicated its
  // occurrence, in which case the rows describe the same sheet — keep the first.
  const bySlug = new Map<string, PublicCalendarEventDTO>();
  for (const e of events) {
    if (e.volunteerSlug && !bySlug.has(e.volunteerSlug)) bySlug.set(e.volunteerSlug, e);
  }

  const rows = await Promise.all(
    [...bySlug.entries()].slice(0, MAX_SHEETS).map(async ([slug, event]): Promise<OpenSheetRow | null> => {
      try {
        const res = await fetch(`${base}/volunteers-public/sheets/${encodeURIComponent(slug)}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cf: { cacheTtl: SHEET_CACHE_S, cacheEverything: true },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { sheet?: PublicVolunteerSheetDTO };
        const sheet = body.sheet;
        if (!sheet || sheet.closed || !Array.isArray(sheet.positions)) return null;
        const left = sheet.positions.reduce(
          (n, p) => n + Math.max(0, (p.slots || 0) - (p.filled || 0)),
          0,
        );
        return left > 0 ? { event, left } : null;
      } catch {
        return null;
      }
    }),
  );

  return rows
    .filter((r): r is OpenSheetRow => r !== null)
    .sort((a, b) => a.event.start.localeCompare(b.event.start))
    .slice(0, ROW_LIMIT);
}

/** The fields this page renders, checked rather than trusted, so a shape
 *  change on the other side degrades to a missing row instead of `undefined`
 *  in the markup — apps/home's `isEvent`, with the fields this block needs. */
function isEvent(e: PublicCalendarEventDTO): boolean {
  return (
    !!e &&
    typeof e.title === "string" &&
    e.title.length > 0 &&
    typeof e.start === "string" &&
    !Number.isNaN(Date.parse(e.start))
  );
}
