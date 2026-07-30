// Managed calendars + their events (system admins). Mounted under /admin
// alongside routes/admin.ts, which keeps the imported-feed CRUD.
//
// Authorization is system-admin-only for now; `created_by` is recorded on every
// row so per-calendar editor delegation can be added later without a migration.

import { Hono } from "hono";
import type { ManagedCalendarInput, ManagedEventInput } from "@sd/shared";
import type { HonoEnv } from "../env.js";
import { requireAuth } from "../middleware/session.js";
import {
  createManagedCalendar,
  createManagedEvent,
  deleteManagedCalendar,
  deleteManagedEvent,
  listManagedCalendars,
  listManagedEvents,
  loadCalendar,
  ManagedEventError,
  updateManagedCalendar,
  updateManagedEvent,
} from "../lib/managedCalendar.js";

export const managedCalendar = new Hono<HonoEnv>();

/** Our own origin, used to build the published .ics URL we hand back to clients. */
function apiOrigin(url: string): string {
  return new URL(url).origin;
}

/** Authored-input failures become a 400 carrying the message, so the admin UI can
 *  show why a recurrence was rejected. Anything else propagates to app.onError. */
function invalid(err: unknown): { error: string; message: string } | null {
  return err instanceof ManagedEventError ? { error: "invalid_body", message: err.message } : null;
}

// ── Calendars ───────────────────────────────────────────────────────────────

/** GET /admin/managed-calendars — every managed calendar with its event count. */
managedCalendar.get("/managed-calendars", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ calendars: await listManagedCalendars(c.env, apiOrigin(c.req.url)) });
});

/** GET /admin/managed-calendars/:id — one calendar, for its detail page. */
managedCalendar.get("/managed-calendars/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const calendar = await loadCalendar(c.env, c.req.param("id"), apiOrigin(c.req.url));
  if (!calendar) return c.json({ error: "not_found" }, 404);
  return c.json({ calendar });
});

/** POST /admin/managed-calendars { name, color?, description? }. */
managedCalendar.post("/managed-calendars", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<ManagedCalendarInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const calendar = await createManagedCalendar(c.env, body, auth.userId, apiOrigin(c.req.url));
    c.var.audit.push({
      action: "calendar.managed.created",
      entityKind: "managed_calendar",
      entityId: calendar.id,
      detail: { name: calendar.name },
    });
    return c.json({ calendar }, 201);
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** PATCH /admin/managed-calendars/:id { name?, color?, description? }. */
managedCalendar.patch("/managed-calendars/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<Partial<ManagedCalendarInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const calendar = await updateManagedCalendar(c.env, c.req.param("id"), body, apiOrigin(c.req.url));
    if (!calendar) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "calendar.managed.updated",
      entityKind: "managed_calendar",
      entityId: calendar.id,
    });
    return c.json({ calendar });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** DELETE /admin/managed-calendars/:id — removes its events and occurrences too. */
managedCalendar.delete("/managed-calendars/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  if (!(await deleteManagedCalendar(c.env, id))) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({
    action: "calendar.managed.deleted",
    entityKind: "managed_calendar",
    entityId: id,
  });
  return c.json({ ok: true });
});

// ── Events ──────────────────────────────────────────────────────────────────

/** GET /admin/managed-calendars/:id/events — the editable series rows (not the
 *  expanded occurrences, which members read via /calendar/events). */
managedCalendar.get("/managed-calendars/:id/events", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  return c.json({ events: await listManagedEvents(c.env, c.req.param("id")) });
});

/** POST /admin/managed-calendars/:id/events — create an event and materialize
 *  its occurrences immediately, so it shows in the agenda without waiting. */
managedCalendar.post("/managed-calendars/:id/events", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<ManagedEventInput>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const event = await createManagedEvent(c.env, c.req.param("id"), body, auth.userId);
    if (!event) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "calendar.event.created",
      entityKind: "managed_event",
      entityId: event.id,
      detail: { calendarId: event.calendarId, occurrences: event.occurrenceCount },
    });
    return c.json({ event }, 201);
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** PATCH /admin/managed-events/:id — re-expands and bumps SEQUENCE. */
managedCalendar.patch("/managed-events/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const body = await c.req.json<Partial<ManagedEventInput>>().catch(() => null);
  if (!body) return c.json({ error: "invalid_body" }, 400);

  try {
    const event = await updateManagedEvent(c.env, c.req.param("id"), body);
    if (!event) return c.json({ error: "not_found" }, 404);
    c.var.audit.push({
      action: "calendar.event.updated",
      entityKind: "managed_event",
      entityId: event.id,
      detail: { occurrences: event.occurrenceCount },
    });
    return c.json({ event });
  } catch (err) {
    const bad = invalid(err);
    if (bad) return c.json(bad, 400);
    throw err;
  }
});

/** DELETE /admin/managed-events/:id. */
managedCalendar.delete("/managed-events/:id", async (c) => {
  const auth = requireAuth(c);
  if (!auth.isSystemAdmin) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  if (!(await deleteManagedEvent(c.env, id))) return c.json({ error: "not_found" }, 404);
  c.var.audit.push({
    action: "calendar.event.deleted",
    entityKind: "managed_event",
    entityId: id,
  });
  return c.json({ ok: true });
});
