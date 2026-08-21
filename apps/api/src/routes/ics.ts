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
import { findEventByPath, renderImportedSourceIcs } from "../lib/calendar.js";
import { icsDate, renderCalendar } from "../lib/icsWriter.js";
import { renderManagedCalendarIcs } from "../lib/managedCalendar.js";
import { nowIso } from "../lib/time.js";

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

/** GET /ics/event/:date/:file — ONE event as a downloadable .ics, where
 *  `:date/:file` is the event page's own path with `.ics` appended. This is the
 *  "Add to my calendar" button on that page.
 *
 *  A COPY, not a subscription — the same distinction the per-calendar sheet
 *  makes: nothing here updates when the school moves the date, which is why the
 *  page offers this beside the calendar's subscribe link rather than instead of
 *  it. A recurring series is deliberately flattened to the one occurrence the
 *  reader is looking at; `recurrence: null` is what says so.
 *
 *  Carries exactly what the anonymous event page already shows, and no more.
 *  Registered above /:file, which only ever matches one segment anyway. */
ics.get("/event/:date/:file", async (c) => {
  const slug = idOf(c.req.param("file"));
  if (!slug) return c.json({ error: "not_found" }, 404);

  const date = c.req.param("date");
  const event = await findEventByPath(c.env, date, slug);
  if (!event) return c.json({ error: "not_found" }, 404);

  // Stable across downloads, so re-adding an event updates the copy already in
  // someone's calendar instead of duplicating it. Derived from the same content
  // identity the URL is, never from event.id — which is re-minted on every
  // refresh (invariant 8) and would make each download look like a new event.
  const uid = `${slug}-${icsDate(event.start, event.allDay)}@eisenhower.school`;
  return icsResponse(
    renderCalendar(event.title, [
      {
        uid,
        title: event.title,
        location: event.location,
        description: event.description,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        recurrence: null,
        sequence: 0,
        updatedAt: nowIso(),
      },
    ]),
  );
});

/** GET /ics/:file — `:file` is `<calendarId>.ics`, a calendar authored here. */
ics.get("/:file", async (c) => {
  const id = idOf(c.req.param("file"));
  if (!id) return c.json({ error: "not_found" }, 404);

  const body = await renderManagedCalendarIcs(c.env, id);
  if (body === null) return c.json({ error: "not_found" }, 404);
  return icsResponse(body);
});
