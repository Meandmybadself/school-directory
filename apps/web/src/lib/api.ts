// Thin fetch client. Always sends credentials so the session cookie rides along.
import type {
  AdminUserDTO,
  AuditEntryDTO,
  BulkImportResult,
  BulkImportRow,
  ContactItemInput,
  PersonSummaryDTO,
  CreateShareBody,
  GroupDetailDTO,
  GroupSummaryDTO,
  MeDTO,
  NeighborsResponse,
  PersonPatchBody,
  PersonProfileDTO,
  ShareGranteeDTO,
  ShareTargetDTO,
} from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

/** Resolve an API-relative media path (e.g. "/photos/abc.jpg") to an absolute URL. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path}`;
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  // Fail writes fast while offline; reads still go through (the SW serves cache).
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
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", { method: "POST", body: JSON.stringify({ email }) }),
  signout: () => request<{ ok: true }>("/auth/signout", { method: "POST" }),

  me: () => request<MeDTO>("/me"),
  createMyPerson: (firstName: string, lastName: string | null) =>
    request<{ id: string }>("/me/persons", { method: "POST", body: JSON.stringify({ firstName, lastName }) }),
  setActivePerson: (personId: string) =>
    request<{ ok: true; activePersonId: string }>("/me/active-person", {
      method: "POST",
      body: JSON.stringify({ personId }),
    }),
  setLocale: (locale: string) =>
    request<{ ok: true }>("/me/locale", { method: "PUT", body: JSON.stringify({ locale }) }),

  person: (id: string) => request<PersonProfileDTO>(`/persons/${id}`),
  patchPerson: (id: string, body: PersonPatchBody) =>
    request<PersonProfileDTO>(`/persons/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  uploadPhoto: async (personId: string, file: File): Promise<{ photoUrl: string }> => {
    if (navigator.onLine === false) throw new ApiError(0, { error: "offline" });
    const res = await fetch(`${API_BASE}/persons/${personId}/photo`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) throw new ApiError(res.status, body);
    return body as { photoUrl: string };
  },

  addContact: (personId: string, body: ContactItemInput) =>
    request<{ id: string }>(`/persons/${personId}/contacts`, { method: "POST", body: JSON.stringify(body) }),
  patchContact: (id: string, body: Partial<ContactItemInput>) =>
    request<{ ok: true }>(`/contacts/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteContact: (id: string) => request<{ ok: true }>(`/contacts/${id}`, { method: "DELETE" }),

  inviteController: (personId: string, email: string) =>
    request<{ ok: true; inviteId: string }>(`/persons/${personId}/controllers`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  neighbors: () => request<NeighborsResponse>("/home/neighbors"),

  directory: (q: string, offset = 0) =>
    request<{ people: PersonSummaryDTO[]; total: number; offset: number; pageSize: number }>(
      `/directory?q=${encodeURIComponent(q)}&offset=${offset}`,
    ),

  group: (id: string) => request<GroupDetailDTO>(`/groups/${id}`),
  searchGroups: (q: string) =>
    request<{ groups: GroupSummaryDTO[] }>(`/groups?q=${encodeURIComponent(q)}`),
  createGroup: (body: { kind: "household" | "classroom"; name: string }) =>
    request<{ id: string }>("/groups", { method: "POST", body: JSON.stringify(body) }),
  groupCandidates: (groupId: string, q: string) =>
    request<{ targets: ShareTargetDTO[] }>(`/groups/${groupId}/candidates?q=${encodeURIComponent(q)}`),
  addGroupMember: (groupId: string, body: { personId: string; title?: string }) =>
    request<{ ok: true }>(`/groups/${groupId}/members`, { method: "POST", body: JSON.stringify(body) }),
  updateGroupMember: (groupId: string, personId: string, body: { title?: string | null; isAdmin?: boolean }) =>
    request<{ ok: true }>(`/groups/${groupId}/members/${personId}`, { method: "PATCH", body: JSON.stringify(body) }),
  removeGroupMember: (groupId: string, personId: string) =>
    request<{ ok: true }>(`/groups/${groupId}/members/${personId}`, { method: "DELETE" }),
  addGroupContact: (groupId: string, body: ContactItemInput) =>
    request<{ id: string }>(`/groups/${groupId}/contacts`, { method: "POST", body: JSON.stringify(body) }),
  patchGroupContact: (groupId: string, contactId: string, body: Partial<ContactItemInput>) =>
    request<{ ok: true }>(`/groups/${groupId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteGroupContact: (groupId: string, contactId: string) =>
    request<{ ok: true }>(`/groups/${groupId}/contacts/${contactId}`, { method: "DELETE" }),

  listShares: (subjectKind: string, subjectRef: string) =>
    request<{ grantees: ShareGranteeDTO[] }>(
      `/shares?subjectKind=${encodeURIComponent(subjectKind)}&subjectRef=${encodeURIComponent(subjectRef)}`,
    ),
  createShare: (body: CreateShareBody) =>
    request<{ ok: true }>("/shares", { method: "POST", body: JSON.stringify(body) }),
  deleteShare: (id: string) => request<{ ok: true }>(`/shares/${id}`, { method: "DELETE" }),
  shareTargets: (q: string) =>
    request<{ targets: ShareTargetDTO[] }>(`/shares/targets?q=${encodeURIComponent(q)}`),

  adminUsers: () => request<{ users: AdminUserDTO[] }>("/admin/users"),
  startMasquerade: (userId: string) =>
    request<{ ok: true }>("/admin/masquerade", { method: "POST", body: JSON.stringify({ userId }) }),
  stopMasquerade: () => request<{ ok: true }>("/admin/masquerade/stop", { method: "POST" }),
  auditLog: (opts: { action?: string; before?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.action) q.set("action", opts.action);
    if (opts.before) q.set("before", opts.before);
    const qs = q.toString();
    return request<{ entries: AuditEntryDTO[]; nextBefore: string | null }>(`/admin/audit${qs ? `?${qs}` : ""}`);
  },
  bulkImport: (rows: BulkImportRow[], dryRun: boolean) =>
    request<BulkImportResult>("/admin/bulk-import", { method: "POST", body: JSON.stringify({ rows, dryRun }) }),
  getRegistration: () => request<{ open: boolean }>("/settings/registration"),
  setRegistration: (open: boolean) =>
    request<{ open: boolean }>("/settings/registration", { method: "PUT", body: JSON.stringify({ open }) }),
};
