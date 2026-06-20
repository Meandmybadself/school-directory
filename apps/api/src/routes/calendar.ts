// Shared calendar reads — available to any signed-in member. Events come from
// public ICS feeds (no per-event privacy), served from D1 (populated by the cron
// refresh in lib/calendar.ts).

import { Hono } from "hono";
import type { CalendarFeedDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import { dedupeEvents, type CalendarRow } from "../lib/calendar.js";

export const calendar = new Hono<HonoEnv>();

/** GET /calendar/sources — enabled feeds (id/name/color only) for the show/hide
 *  filter. No URLs or status; available to any member. */
calendar.get("/sources", async (c) => {
  requireAuth(c);
  const rows = await c.env.DB.prepare(
    "SELECT id, name, color, url FROM calendar_source WHERE enabled = 1 ORDER BY name COLLATE NOCASE",
  ).all<CalendarFeedDTO>();
  return c.json({ sources: rows.results });
});

/** GET /calendar/events?limit=&from= — upcoming (ongoing or future) events,
 *  earliest first. `from` defaults to now; an event counts as upcoming if it
 *  ends at/after `from`, has no end (open-ended/all-day without DTEND), or
 *  starts at/after `from`. Stored events are already bounded to the refresh
 *  window (≈ now-2d forward), so an open-ended past event can't accumulate. */
calendar.get("/events", async (c) => {
  requireAuth(c);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const from = c.req.query("from") || new Date().toISOString();
  // Over-fetch so that de-duplicating the same event across feeds still yields
  // up to `limit` distinct events.
  const fetchCap = Math.min(limit * 5, 2000);

  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.location, e.description, e.starts_at, e.ends_at, e.all_day,
            e.source_id, s.name AS source_name, s.color AS source_color
     FROM calendar_event e JOIN calendar_source s ON s.id = e.source_id
     WHERE (e.ends_at >= ? OR e.ends_at IS NULL OR e.starts_at >= ?)
     ORDER BY e.starts_at ASC
     LIMIT ?`,
  )
    .bind(from, from, fetchCap)
    .all<CalendarRow>();

  return c.json({ events: dedupeEvents(rows.results, limit) });
});
