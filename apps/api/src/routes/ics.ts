// Published ICS feeds for managed calendars.
//
// Deliberately unauthenticated: a calendar client (Google, Apple, Outlook) can't
// send a session cookie, so a signed-in-only feed can't be subscribed to. The
// URL is therefore world-readable to anyone holding the calendar's id, and there
// is no revocation short of deleting the calendar. That's an accepted trade —
// these feeds carry school event data only, never member PII — but it does mean
// nothing member-specific may ever be added to this response.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { renderManagedCalendarIcs } from "../lib/managedCalendar.js";

export const ics = new Hono<HonoEnv>();

/** GET /ics/:file — `:file` is `<calendarId>.ics`. */
ics.get("/:file", async (c) => {
  const file = c.req.param("file");
  if (!file.endsWith(".ics")) return c.json({ error: "not_found" }, 404);

  const body = await renderManagedCalendarIcs(c.env, file.slice(0, -4));
  if (body === null) return c.json({ error: "not_found" }, 404);

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Subscribers poll on their own cadence; a few minutes of staleness is
      // fine and keeps a popular feed off the Worker's critical path.
      "cache-control": "public, max-age=300",
    },
  });
});
