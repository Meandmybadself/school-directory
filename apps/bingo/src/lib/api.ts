// Thin fetch client, the same shape as every sibling app's, pointed at the
// same API Worker. Reads ride /bingo-public (no session); writes ride /bingo
// with credentials — the host-only sd_session cookie travels because this app
// is an eisenhower.school subdomain, same-site to the API. The API must list
// this origin in ALLOWED_ORIGINS (apps/api/wrangler.toml).

import type { BingoStateDTO, BingoStateInput } from "@sd/shared";

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number) {
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
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export const api = {
  /** The live board — no session needed. */
  state: () => request<{ state: BingoStateDTO }>("/bingo-public/state"),
  /** Replace the board — needs a session. */
  putState: (state: BingoStateInput) =>
    request<{ state: BingoStateDTO }>("/bingo/state", { method: "PUT", body: JSON.stringify(state) }),
  /** Session probe: 200 means this device can operate the board. */
  me: () => request<unknown>("/me"),
  /** Magic link, landing back on THIS origin (it is in the returnTo allowlist
   *  because it is in ALLOWED_ORIGINS — the same trust boundary). */
  authStart: (email: string) =>
    request<{ ok: true }>("/auth/start", {
      method: "POST",
      body: JSON.stringify({ email, returnTo: window.location.origin }),
    }),
};
