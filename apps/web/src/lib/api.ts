// Thin fetch client. Always sends credentials so the session cookie rides along.
import type {
  ContactItemInput,
  CreateShareBody,
  GroupDetailDTO,
  MeDTO,
  NeighborsResponse,
  PersonPatchBody,
  PersonProfileDTO,
  ShareGranteeDTO,
  ShareTargetDTO,
} from "@sd/shared";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  group: (id: string) => request<GroupDetailDTO>(`/groups/${id}`),
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
};
