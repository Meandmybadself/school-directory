// Thin fetch client, the same shape as the directory, calendar, newsletter and
// store apps'. Points at the SAME API Worker: the session cookie is host-only to
// that Worker and every SPA lives on an eisenhower.school subdomain, so
// credentialed requests carry it with no cross-domain cookie tricks. The API
// must list this origin in ALLOWED_ORIGINS.
//
// Unlike the store's client, EVERY call here needs a session — and most of them
// need more than one: `/pto/*` is gated on PTO-board membership as well, server
// side, by `ptoAccess` in the API. A 403 from any of these means "signed in, but
// not on the board", which is a different screen from a 401.
//
// Note the shape of the write endpoints: nearly all of them return the WHOLE
// board rather than the row they changed. A board is small, every mutation moves
// something the rest of the board can see (a card's column, a count, an
// assignee), and re-rendering from one authoritative payload is what stops the
// client's copy drifting from the server's after a drag that lost a race.
import type {
  Locale,
  MeDTO,
  PtoAccessDTO,
  PtoBoardDTO,
  PtoBoardDetailDTO,
  PtoBoardImpactDTO,
  PtoCardMoveBody,
  PtoCardPatchBody,
  PtoCommentDTO,
  PtoEventOptionDTO,
  PtoLabelColor,
  PtoPersonDTO,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
/** Sibling apps — linked to from nav; not API bases. */
export const DIRECTORY_URL = import.meta.env.VITE_DIRECTORY_URL ?? "http://localhost:5173";
export const CALENDAR_URL = import.meta.env.VITE_CALENDAR_URL ?? "http://localhost:5174";
export const NEWSLETTER_URL = import.meta.env.VITE_NEWSLETTER_URL ?? "http://localhost:5175";
export const STORE_URL = import.meta.env.VITE_STORE_URL ?? "http://localhost:5177";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

/** The server's human-readable reason, when it sent one. `lib/ptoBoard.ts`
 *  raises `PtoError` with sentences meant to be shown ("A board may have at most
 *  30 columns."), so this is not decoration. */
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
      ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }) satisfies RequestInit;
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) }) satisfies RequestInit;
const patch = (body: unknown) => ({ method: "PATCH", body: JSON.stringify(body) }) satisfies RequestInit;

type BoardResponse = { board: PtoBoardDetailDTO };

export const api = {
  // Auth — `returnTo` is this app's origin, so the magic link comes back here
  // rather than to the directory. The session itself is shared either way.
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", post({ email, returnTo: window.location.origin })),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),
  me: () => request<MeDTO>("/me"),
  setLocale: (locale: Locale) => request<{ ok: true }>("/me/locale", put({ locale })),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),

  // ── The gate ──
  access: () => request<PtoAccessDTO>("/pto/access"),

  // ── Boards ──
  boards: (archived = false) =>
    request<{ boards: PtoBoardDTO[] }>(`/pto/boards${archived ? "?archived=1" : ""}`),
  board: (slug: string) => request<BoardResponse>(`/pto/boards/${encodeURIComponent(slug)}`),
  createBoard: (body: { title: string; summary?: string | null; managedEventId?: string | null }) =>
    request<BoardResponse>("/pto/boards", post(body)),
  patchBoard: (
    id: string,
    body: { title?: string; summary?: string | null; managedEventId?: string | null; archived?: boolean },
  ) => request<BoardResponse>(`/pto/boards/${id}`, patch(body)),
  boardImpact: (id: string) => request<{ impact: PtoBoardImpactDTO }>(`/pto/boards/${id}/removal-impact`),
  deleteBoard: (id: string) =>
    request<{ ok: true; impact: PtoBoardImpactDTO }>(`/pto/boards/${id}`, { method: "DELETE" }),

  // ── Columns ──
  createList: (boardId: string, title: string) =>
    request<BoardResponse>(`/pto/boards/${boardId}/lists`, post({ title })),
  renameList: (id: string, title: string) => request<BoardResponse>(`/pto/lists/${id}`, patch({ title })),
  deleteList: (id: string) => request<BoardResponse>(`/pto/lists/${id}`, { method: "DELETE" }),

  // ── Cards ──
  createCard: (boardId: string, body: { listId: string; title: string }) =>
    request<BoardResponse>(`/pto/boards/${boardId}/cards`, post(body)),
  patchCard: (id: string, body: PtoCardPatchBody) => request<BoardResponse>(`/pto/cards/${id}`, patch(body)),
  moveCard: (id: string, body: PtoCardMoveBody) => request<BoardResponse>(`/pto/cards/${id}/move`, post(body)),
  deleteCard: (id: string) => request<BoardResponse>(`/pto/cards/${id}`, { method: "DELETE" }),
  setAssignees: (id: string, personIds: string[]) =>
    request<BoardResponse>(`/pto/cards/${id}/assignees`, put({ personIds })),

  // ── Comments ──
  comments: (cardId: string) => request<{ comments: PtoCommentDTO[] }>(`/pto/cards/${cardId}/comments`),
  addComment: (cardId: string, body: string) =>
    request<{ comments: PtoCommentDTO[] }>(`/pto/cards/${cardId}/comments`, post({ body })),
  deleteComment: (id: string) =>
    request<{ comments: PtoCommentDTO[] }>(`/pto/comments/${id}`, { method: "DELETE" }),

  // ── Labels ──
  createLabel: (boardId: string, name: string, color: PtoLabelColor) =>
    request<BoardResponse>(`/pto/boards/${boardId}/labels`, post({ name, color })),
  deleteLabel: (boardId: string, labelId: string) =>
    request<BoardResponse>(`/pto/boards/${boardId}/labels/${labelId}`, { method: "DELETE" }),

  // ── Pickers ──
  roster: () => request<{ people: PtoPersonDTO[] }>("/pto/roster"),
  events: () => request<{ events: PtoEventOptionDTO[] }>("/pto/events"),

  // ── Settings (system admin) ──
  groups: () => request<{ groups: { id: string; name: string; memberCount: number }[] }>("/pto/groups"),
  setGroup: (groupId: string | null) => request<PtoAccessDTO>("/pto/settings", put({ groupId })),
};
