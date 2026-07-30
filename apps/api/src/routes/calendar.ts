// Shared calendar reads — available to any signed-in member. Events come from
// two origins that share one read model (`calendar_event`): public ICS feeds
// imported by the cron refresh (lib/calendar.ts), and calendars authored here
// (lib/managedCalendar.ts). Neither carries per-event privacy.

import { Hono } from "hono";
import type { CalendarFeedDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { dedupeEvents, type CalendarRow } from "../lib/calendar.js";

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

/** GET /calendar/events?limit=&from= — upcoming (ongoing or future) events,
 *  earliest first. `from` defaults to now; an event counts as upcoming if it
 *  ends at/after `from`, has no end (open-ended/all-day without DTEND), or
 *  starts at/after `from`. Imported events are bounded to the refresh window
 *  (≈ now-2d forward) and managed ones to their recurrence's UNTIL, so an
 *  open-ended past event can't accumulate. */
calendar.get("/events", async (c) => {
  requireAuth(c);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const from = c.req.query("from") || new Date().toISOString();
  // Over-fetch so that de-duplicating the same event across feeds still yields
  // up to `limit` distinct events.
  const fetchCap = Math.min(limit * 5, 2000);

  // One query over both origins: a row's calendar is whichever of the two joins
  // matched, which the CHECK constraint in migration 0009 guarantees is exactly one.
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.location, e.description, e.starts_at, e.ends_at, e.all_day,
            e.managed_event_id,
            COALESCE(e.source_id, e.managed_calendar_id) AS source_id,
            COALESCE(s.name, mc.name) AS source_name,
            COALESCE(s.color, mc.color) AS source_color
     FROM calendar_event e
     LEFT JOIN calendar_source s ON s.id = e.source_id
     LEFT JOIN managed_calendar mc ON mc.id = e.managed_calendar_id
     WHERE (e.ends_at >= ? OR e.ends_at IS NULL OR e.starts_at >= ?)
     ORDER BY e.starts_at ASC
     LIMIT ?`,
  )
    .bind(from, from, fetchCap)
    .all<CalendarRow>();

  return c.json({ events: dedupeEvents(rows.results, limit) });
});
