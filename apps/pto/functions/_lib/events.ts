// The one subrequest this page makes: the next few events off the calendar.
//
// A port of apps/home/src/events.ts, and every line of that file's reasoning
// applies here unchanged:
//
//  - **It reads the ANONYMOUS route.** `/calendar-public/events` runs everything
//    through `publicEventOf` (invariant 12), so a field added to the
//    member-facing DTO cannot ride into this page by itself. This is an INDEXED
//    surface, so it must never call the members-only `/calendar/*` twin, no
//    matter that a Pages Function could.
//  - **It can never take the page down.** A timeout, a non-200, a body that
//    isn't what we expect and an unset `API_BASE` all resolve to an empty list,
//    and an empty list hides the block.
//  - **It is edge-cached**, so the common request never leaves the colo.
//
// Why read them at all rather than transcribing the dates into `_lib/pto.ts`
// with the rest of the facts: a date copied onto a page nobody edits is wrong
// the moment the school moves the event. The month strip beside this block is
// deliberately dateless for the same reason — it says WHAT happens and roughly
// WHEN in the year, and this says what is actually next.

import type { PublicCalendarEventDTO } from "@sd/shared";
import type { PagesEnv } from "./page.js";

/** How many rows to show. Brief on purpose — the calendar owns the whole year
 *  and is one tap away. */
export const EVENT_LIMIT = 5;

const TIMEOUT_MS = 1200;
const CACHE_TTL_S = 300;

export async function upcomingEvents(env: PagesEnv): Promise<PublicCalendarEventDTO[]> {
  const base = env.API_BASE?.replace(/\/$/, "");
  if (!base) return [];

  try {
    const res = await fetch(`${base}/calendar-public/events?limit=${EVENT_LIMIT}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cf: { cacheTtl: CACHE_TTL_S, cacheEverything: true },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { events?: unknown };
    if (!Array.isArray(body.events)) return [];
    return (body.events as PublicCalendarEventDTO[]).filter(isEvent).slice(0, EVENT_LIMIT);
  } catch {
    return [];
  }
}

/** The fields this page renders, checked rather than trusted, so a shape change
 *  on the other side degrades to a missing row instead of `undefined` in the
 *  markup. */
function isEvent(e: PublicCalendarEventDTO): boolean {
  return (
    !!e &&
    typeof e.title === "string" &&
    e.title.length > 0 &&
    typeof e.start === "string" &&
    !Number.isNaN(Date.parse(e.start))
  );
}
