// The one subrequest this Worker makes: the next few events off the calendar.
//
// It is worth being explicit about what this costs, because the front door was
// built as a pure function of the URL and the Accept-Language header and this
// is the thing that changes that:
//
//  - **It reads the ANONYMOUS route.** `/calendar-public/events` runs everything
//    through `publicEventOf` (CLAUDE.md invariant 12), so a field added to the
//    member-facing DTO cannot ride into this page by itself. This page is the
//    only surface in the project that asks to be indexed, so it must never call
//    the members-only `/calendar/*` twin, no matter that a Worker could.
//  - **It can never take the page down.** A timeout, a non-200, a body that
//    isn't what we expect and an unset `API_URL` all resolve to an empty list,
//    and an empty list hides the block. The page still renders everything else.
//  - **It is edge-cached**, so the common request never leaves the colo. A few
//    minutes of staleness on "what's coming up" is invisible; a subrequest per
//    reader is not.

import type { PublicCalendarEventDTO } from "@sd/shared";
import type { Env } from "./env.js";

/** How many rows the front door shows. Brief on purpose — the calendar is one
 *  tap away and owns the whole year. */
export const EVENT_LIMIT = 4;

/** A slow API must not hold the front door open; the block just doesn't render. */
const TIMEOUT_MS = 1200;

/** Long enough that most readers are served from the edge, short enough that a
 *  newly-added event shows up the same morning. */
const CACHE_TTL_S = 300;

export async function upcomingEvents(env: Env): Promise<PublicCalendarEventDTO[]> {
  const base = env.API_URL?.replace(/\/$/, "");
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

/** The four fields this page renders. Checked rather than trusted, so a shape
 *  change on the other side degrades to a missing row instead of `undefined`
 *  in the markup. */
function isEvent(e: PublicCalendarEventDTO): boolean {
  return (
    !!e &&
    typeof e.title === "string" &&
    e.title.length > 0 &&
    typeof e.start === "string" &&
    !Number.isNaN(Date.parse(e.start))
  );
}
