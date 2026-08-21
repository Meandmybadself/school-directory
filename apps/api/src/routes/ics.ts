// Published ICS feeds — one per calendar, whether authored here or imported.
//
// Deliberately unauthenticated: a calendar client (Google, Apple, Outlook) can't
// send a session cookie, so a signed-in-only feed can't be subscribed to. The
// URL is therefore world-readable to anyone holding the calendar's id, and there
// is no revocation short of deleting the calendar. That's an accepted trade —
// these feeds carry school event data only, never member PII — but it does mean
// nothing member-specific may ever be added to either response.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { renderImportedSourceIcs } from "../lib/calendar.js";
import { renderManagedCalendarIcs } from "../lib/managedCalendar.js";

export const ics = new Hono<HonoEnv>();

function icsResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      // Subscribers poll on their own cadence; a few minutes of staleness is
      // fine and keeps a popular feed off the Worker's critical path.
      "cache-control": "public, max-age=300",
    },
  });
}

/** Strip the `.ics` suffix off `:file`, or null if it isn't one. */
function idOf(file: string): string | null {
  return file.endsWith(".ics") ? file.slice(0, -4) : null;
}

/** GET /ics/source/:file — `:file` is `<sourceId>.ics`, an IMPORTED calendar
 *  mirrored from the events we store. Registered before /:file, which would
 *  otherwise never see a two-segment path anyway.
 *
 *  Mirrored, not proxied: this never fetches or reveals the upstream feed. See
 *  renderImportedSourceIcs for what that costs and why it's the point. */
ics.get("/source/:file", async (c) => {
  const id = idOf(c.req.param("file"));
  if (!id) return c.json({ error: "not_found" }, 404);

  const body = await renderImportedSourceIcs(c.env, id);
  if (body === null) return c.json({ error: "not_found" }, 404);
  return icsResponse(body);
});

/** GET /ics/:file — `:file` is `<calendarId>.ics`, a calendar authored here. */
ics.get("/:file", async (c) => {
  const id = idOf(c.req.param("file"));
  if (!id) return c.json({ error: "not_found" }, 404);

  const body = await renderManagedCalendarIcs(c.env, id);
  if (body === null) return c.json({ error: "not_found" }, 404);
  return icsResponse(body);
});
