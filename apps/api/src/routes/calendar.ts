// Shared calendar reads — available to any signed-in member. Events come from
// two origins that share one read model (`calendar_event`): public ICS feeds
// imported by the cron refresh (lib/calendar.ts), and calendars authored here
// (lib/managedCalendar.ts). Neither carries per-event privacy.

import { Hono } from "hono";
import type { CalendarFeedDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { queryUpcomingEvents } from "../lib/calendar.js";

export const calendar = new Hono<HonoEnv>();

/** GET /calendar/sources — every calendar available to the show/hide filter:
 *  enabled imported feeds (upstream URL) plus managed calendars (this API's own
 *  published feed). Admin-only status/error fields stay out of this response. */
calendar.get("/sources", async (c) => {
  requireAuth(c);
  const [imported, managed] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id, name, color, url FROM calendar_source WHERE enabled = 1 ORDER BY name COLLATE NOCASE",
    ).all<CalendarFeedDTO>(),
    c.env.DB.prepare(
      "SELECT id, name, color FROM managed_calendar ORDER BY name COLLATE NOCASE",
    ).all<{ id: string; name: string; color: string }>(),
  ]);

  const origin = new URL(c.req.url).origin;
  const managedFeeds: CalendarFeedDTO[] = managed.results.map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
    url: `${origin}/ics/${m.id}.ics`,
  }));
  return c.json({ sources: [...imported.results, ...managedFeeds] });
});

/** GET /calendar/events?limit=&from=&to=&calendars= — upcoming (ongoing or
 *  future) events, earliest first. `from` defaults to now; an event counts as
 *  upcoming if it ends at/after `from`, has no end (open-ended/all-day without
 *  DTEND), or starts at/after `from`. Imported events are bounded to the refresh
 *  window (≈ now-2d forward) and managed ones to their recurrence's UNTIL, so an
 *  open-ended past event can't accumulate.
 *
 *  `to` (ISO, exclusive upper bound on the start) and `calendars` (comma-
 *  separated CalendarFeedDTO ids) are optional and exist for the newsletter's
 *  upcoming-events block, which needs a fixed window over chosen calendars.
 *  Both default to unbounded, so existing callers are unaffected. */
calendar.get("/events", async (c) => {
  requireAuth(c);
  const calendars = (c.req.query("calendars") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const events = await queryUpcomingEvents(c.env, {
    from: c.req.query("from") || new Date().toISOString(),
    to: c.req.query("to") || undefined,
    calendarIds: calendars,
    limit: Number(c.req.query("limit")) || 100,
  });
  return c.json({ events });
});
