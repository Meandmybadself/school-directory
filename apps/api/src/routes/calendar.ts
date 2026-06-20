// Shared calendar reads — available to any signed-in member. Events come from
// public ICS feeds (no per-event privacy), served from D1 (populated by the cron
// refresh in lib/calendar.ts).

import { Hono } from "hono";
import type { CalendarEventDTO } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";

export const calendar = new Hono<HonoEnv>();

interface EventRow {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  source_name: string;
  source_color: string;
}

/** GET /calendar/events?limit=&from= — upcoming (ongoing or future) events,
 *  earliest first. `from` defaults to now; an event counts as upcoming if it
 *  ends at/after `from`, has no end (open-ended/all-day without DTEND), or
 *  starts at/after `from`. Stored events are already bounded to the refresh
 *  window (≈ now-2d forward), so an open-ended past event can't accumulate. */
calendar.get("/events", async (c) => {
  requireAuth(c);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
  const from = c.req.query("from") || new Date().toISOString();

  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.title, e.location, e.starts_at, e.ends_at, e.all_day,
            s.name AS source_name, s.color AS source_color
     FROM calendar_event e JOIN calendar_source s ON s.id = e.source_id
     WHERE (e.ends_at >= ? OR e.ends_at IS NULL OR e.starts_at >= ?)
     ORDER BY e.starts_at ASC
     LIMIT ?`,
  )
    .bind(from, from, limit)
    .all<EventRow>();

  const events: CalendarEventDTO[] = rows.results.map((r) => ({
    id: r.id,
    title: r.title,
    location: r.location,
    start: r.starts_at,
    end: r.ends_at,
    allDay: r.all_day === 1,
    source: { name: r.source_name, color: r.source_color },
  }));
  return c.json({ events });
});
