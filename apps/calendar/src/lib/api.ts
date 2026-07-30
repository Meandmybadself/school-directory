// Thin fetch client, same shape as the directory app's. Points at the SAME API
// Worker: the session cookie is host-only to that Worker and both SPAs live on
// eisenhower.school subdomains, so credentialed requests carry the cookie with no
// cross-domain cookie tricks. The API must list this origin in ALLOWED_ORIGINS.
import type {
  CalendarEventDTO,
  CalendarFeedDTO,
  CalendarSourceDTO,
  CalendarSourceInput,
  Locale,
  ManagedCalendarDTO,
  ManagedCalendarInput,
  ManagedEventDTO,
  ManagedEventInput,
  MeDTO,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** The directory app — linked to from nav; not an API base. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";

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

  // Member calendar reads — imported feeds and managed calendars, unioned.
  calendarEvents: (opts: { limit?: number; from?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.from) q.set("from", opts.from);
    const qs = q.toString();
    return request<{ events: CalendarEventDTO[] }>(`/calendar/events${qs ? `?${qs}` : ""}`);
  },
  calendarFeeds: () => request<{ sources: CalendarFeedDTO[] }>("/calendar/sources"),

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
};
