import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../env.js";

export const SESSION_COOKIE = "sd_session";
export const ACTIVE_PERSON_COOKIE = "sd_active_person";

const baseOpts = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  path: "/",
};

export function readSessionId(c: Context<HonoEnv>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function setSessionCookie(c: Context<HonoEnv>, id: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, id, { ...baseOpts, maxAge: maxAgeSeconds });
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, SESSION_COOKIE, baseOpts);
}

export function readActivePerson(c: Context<HonoEnv>): string | undefined {
  return getCookie(c, ACTIVE_PERSON_COOKIE);
}

export function clearActivePersonCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, ACTIVE_PERSON_COOKIE, { secure: true, sameSite: "Lax", path: "/" });
}

export function setActivePersonCookie(c: Context<HonoEnv>, personId: string): void {
  // Readable client-side is unnecessary; keep httpOnly off so SPA can read if needed.
  setCookie(c, ACTIVE_PERSON_COOKIE, personId, {
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}
