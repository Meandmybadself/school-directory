// Thin fetch client, same shape as the directory app's. Points at the SAME API
// Worker: the session cookie is host-only to that Worker and both SPAs live on
// eisenhower.school subdomains, so credentialed requests carry the cookie with no
// cross-domain cookie tricks. The API must list this origin in ALLOWED_ORIGINS.
import type {
  PublicCalendarEventDTO,
  PublicCalendarFeedDTO,
  CalendarSourceDTO,
  CalendarSourceInput,
  Locale,
  ManagedCalendarDTO,
  ManagedCalendarInput,
  ManagedEventDTO,
  ManagedEventInput,
  ManagedOccurrenceDTO,
  MeDTO,
  PublicVolunteerSheetDTO,
  VolunteerPositionInput,
  VolunteerSheetDTO,
  VolunteerSheetInput,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** The directory app — linked to from nav; not an API base. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";
/** The newsletter app — linked to from nav; not an API base. */
export const NEWSLETTER_URL = import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

/** The server's human-readable reason, when it sent one (managed-calendar routes
 *  return `message` on a 400 so a rejected recurrence can explain itself). */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.body && typeof err.body === "object") {
    const msg = (err.body as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  if (isMutation && navigator.onLine === false) {
    throw new ApiError(0, { error: "offline" });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const api = {
  // Auth. `returnTo` is this app's origin, so the magic link comes back here
  // rather than to the directory (the API validates it against ALLOWED_ORIGINS).
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", {
      method: "POST",
      body: JSON.stringify({ email, returnTo: window.location.origin }),
    }),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),
  me: () => request<MeDTO>("/me"),
  setLocale: (locale: Locale) =>
    request<{ ok: true }>("/me/locale", { method: "PUT", body: JSON.stringify({ locale }) }),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),

  // Agenda reads — imported feeds and managed calendars, unioned.
  //
  // Deliberately the /calendar-public/* routes, not the session-gated
  // /calendar/* ones: this app's home screen renders for anonymous visitors, so
  // these two calls must succeed with no cookie. They return
  // PublicCalendarEventDTO, which omits seriesId/recurrenceId — nothing in this
  // app reads those, and the narrower type is what keeps it that way.
  calendarEvents: (opts: { limit?: number; from?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.from) q.set("from", opts.from);
    const qs = q.toString();
    return request<{ events: PublicCalendarEventDTO[] }>(
      `/calendar-public/events${qs ? `?${qs}` : ""}`,
    );
  },
  calendarFeeds: () => request<{ sources: PublicCalendarFeedDTO[] }>("/calendar-public/sources"),

  // Imported ICS sources (admin).
  calendarSources: () => request<{ sources: CalendarSourceDTO[] }>("/admin/calendar-sources"),
  addCalendarSource: (body: CalendarSourceInput) =>
    request<{ source: CalendarSourceDTO }>("/admin/calendar-sources", { method: "POST", body: JSON.stringify(body) }),
  updateCalendarSource: (id: string, body: Partial<CalendarSourceInput>) =>
    request<{ source: CalendarSourceDTO }>(`/admin/calendar-sources/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCalendarSource: (id: string) =>
    request<{ ok: true }>(`/admin/calendar-sources/${id}`, { method: "DELETE" }),
  refreshCalendar: () =>
    request<{ ok: true; sources: number; events: number }>("/admin/calendar-sources/refresh", { method: "POST" }),

  // Managed calendars (admin).
  managedCalendars: () => request<{ calendars: ManagedCalendarDTO[] }>("/admin/managed-calendars"),
  managedCalendar: (id: string) =>
    request<{ calendar: ManagedCalendarDTO }>(`/admin/managed-calendars/${id}`),
  addManagedCalendar: (body: ManagedCalendarInput) =>
    request<{ calendar: ManagedCalendarDTO }>("/admin/managed-calendars", { method: "POST", body: JSON.stringify(body) }),
  updateManagedCalendar: (id: string, body: Partial<ManagedCalendarInput>) =>
    request<{ calendar: ManagedCalendarDTO }>(`/admin/managed-calendars/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteManagedCalendar: (id: string) =>
    request<{ ok: true }>(`/admin/managed-calendars/${id}`, { method: "DELETE" }),

  // Managed events (admin).
  managedEvents: (calendarId: string) =>
    request<{ events: ManagedEventDTO[] }>(`/admin/managed-calendars/${calendarId}/events`),
  addManagedEvent: (calendarId: string, body: ManagedEventInput) =>
    request<{ event: ManagedEventDTO }>(`/admin/managed-calendars/${calendarId}/events`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateManagedEvent: (eventId: string, body: Partial<ManagedEventInput>) =>
    request<{ event: ManagedEventDTO }>(`/admin/managed-events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteManagedEvent: (eventId: string) =>
    request<{ ok: true }>(`/admin/managed-events/${eventId}`, { method: "DELETE" }),

  // Volunteer sheets — reads.
  //
  // TWO endpoints for one screen, deliberately. `publicVolunteerSheet` returns
  // counts and no names and needs no cookie; `volunteerSheet` returns the roster
  // and requires one. The screen picks by whether there's a session, so an
  // anonymous reader never issues a request that would 401, and a member never
  // renders a page missing the names they're entitled to. The narrower
  // PublicVolunteerSheetDTO is what keeps the signed-out branch honest.
  publicVolunteerSheet: (slug: string) =>
    request<{ sheet: PublicVolunteerSheetDTO }>(`/volunteers-public/sheets/${slug}`),
  volunteerSheet: (slug: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/volunteers/sheets/${slug}`),

  // Volunteer sheets — member writes. Both return the refreshed sheet, so the
  // screen never has to guess what the server decided about counts.
  claimVolunteerSpot: (positionId: string, personId: string, note: string | null) =>
    request<{ sheet: VolunteerSheetDTO }>(`/volunteers/positions/${positionId}/signups`, {
      method: "POST",
      body: JSON.stringify({ personId, note }),
    }),
  releaseVolunteerSpot: (signupId: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/volunteers/signups/${signupId}`, { method: "DELETE" }),

  // Volunteer sheets — authoring (admin).
  eventOccurrences: (eventId: string) =>
    request<{ occurrences: ManagedOccurrenceDTO[] }>(`/admin/managed-events/${eventId}/occurrences`),
  adminVolunteerSheet: (sheetId: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-sheets/${sheetId}`),
  addVolunteerSheet: (eventId: string, body: VolunteerSheetInput) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/managed-events/${eventId}/sheets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVolunteerSheet: (sheetId: string, body: VolunteerSheetInput) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-sheets/${sheetId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteVolunteerSheet: (sheetId: string) =>
    request<{ ok: true }>(`/admin/volunteer-sheets/${sheetId}`, { method: "DELETE" }),
  addVolunteerPosition: (sheetId: string, body: VolunteerPositionInput) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-sheets/${sheetId}/positions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateVolunteerPosition: (positionId: string, body: Partial<VolunteerPositionInput>) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-positions/${positionId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteVolunteerPosition: (positionId: string) =>
    request<{ sheet: VolunteerSheetDTO }>(`/admin/volunteer-positions/${positionId}`, {
      method: "DELETE",
    }),
};
