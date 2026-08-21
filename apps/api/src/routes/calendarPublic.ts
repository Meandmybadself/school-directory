// Anonymous calendar reads — the public agenda at calendar.eisenhower.school.
//
// Deliberately unauthenticated, the same way routes/ics.ts and
// routes/newsletterPublic.ts are: no handler here calls requireAuth, and that
// absence IS the mechanism (sessionMiddleware populates c.var.auth but never
// rejects). Grep this file for `requireAuth` and finding nothing is the point.
//
// Every calendar is public by product decision — there is no per-calendar
// visibility flag, and the underlying managed calendars were already
// world-readable through /ics/:id.ics anyway. The same holds for an imported
// calendar's /ics/source/:id.ics mirror: it re-serves the events this route
// already hands to anonymous callers, and never the upstream feed. What is NOT
// automatic is the event shape: responses go through `publicEventOf`, which hand-builds
// PublicCalendarEventDTO rather than returning CalendarEventDTO, so a field
// added to the member-facing DTO can never ride along into this response by
// itself. Volunteer signups (CLAUDE.md invariant 8) are the case that seam
// exists for — they key on seriesId/recurrenceId, which this route withholds.
//
// The member-facing /calendar/* routes still require auth and still return the
// full DTO; apps/web depends on that. This is an additional surface, not a
// replacement.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { findEventByPath, listPublicCalendarFeeds, publicEventOf, queryUpcomingEvents } from "../lib/calendar.js";
import { upcomingEventsQuery } from "./calendar.js";

export const calendarPublic = new Hono<HonoEnv>();

/** GET /calendar-public/sources — calendars for the show/hide filter, each with
 *  a subscribe URL on THIS origin: an imported feed's is our own mirror, never
 *  the upstream URL an admin pasted. See PublicCalendarFeedDTO. */
calendarPublic.get("/sources", async (c) => {
  const sources = await listPublicCalendarFeeds(c.env, new URL(c.req.url).origin);
  return c.json({ sources });
});

/** GET /calendar-public/events — upcoming events, narrowed for anonymous
 *  callers. Same query surface as the member route (see upcomingEventsQuery) so
 *  the two can't diverge in how they window or filter; they differ only in auth
 *  and in the response shape. */
calendarPublic.get("/events", async (c) => {
  const events = await queryUpcomingEvents(c.env, upcomingEventsQuery(c));
  return c.json({ events: events.map(publicEventOf) });
});

/** GET /calendar-public/events/:date/:slug — ONE event, for its own page.
 *
 *  The path is a content identity, not an id — see packages/shared/src/eventPath.ts
 *  and `findEventByPath`. It resolves an IMPORTED event as readily as a managed
 *  one, which is the whole reason it isn't a minted slug.
 *
 *  Narrowed through `publicEventOf` like everything else here, so the page an
 *  anonymous reader opens from a text message carries no `seriesId` and no
 *  upstream feed URL. `volunteerSlug` survives, and is what lets that page show
 *  the signup sheet (counts only, until they sign in). */
calendarPublic.get("/events/:date/:slug", async (c) => {
  const event = await findEventByPath(c.env, c.req.param("date"), c.req.param("slug"));
  if (!event) return c.json({ error: "not_found" }, 404);
  return c.json({ event: publicEventOf(event) });
});
