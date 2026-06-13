// Thin fetch client. Always sends credentials so the session cookie rides along.
import type {
  ContactItemInput,
  MeDTO,
  NeighborsResponse,
  PersonPatchBody,
  PersonProfileDTO,
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
};
