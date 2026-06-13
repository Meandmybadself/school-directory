import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../env.js";

export const SESSION_COOKIE = "sd_session";
export const ACTIVE_PERSON_COOKIE = "sd_active_person";

// Mark cookies Secure only when actually served over HTTPS. In local dev the API
// is http://localhost, and some browsers (notably Safari) silently DROP Secure
// cookies on http — which made sessions fail to persist. In production (HTTPS)
// this resolves to true. SameSite=Lax is correct: the SPA and API are same-site
// (localhost in dev; same registrable domain in prod), so the cookie rides along.
function isHttps(c: Context<HonoEnv>): boolean {
  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

function baseOpts(c: Context<HonoEnv>) {
  return {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax" as const,
    path: "/",
  };
}

export function readSessionId(c: Context<HonoEnv>): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function setSessionCookie(c: Context<HonoEnv>, id: string, maxAgeSeconds: number): void {
  setCookie(c, SESSION_COOKIE, id, { ...baseOpts(c), maxAge: maxAgeSeconds });
}

export function clearSessionCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, SESSION_COOKIE, baseOpts(c));
}

export function readActivePerson(c: Context<HonoEnv>): string | undefined {
  return getCookie(c, ACTIVE_PERSON_COOKIE);
}

export function clearActivePersonCookie(c: Context<HonoEnv>): void {
  deleteCookie(c, ACTIVE_PERSON_COOKIE, { secure: isHttps(c), sameSite: "Lax", path: "/" });
}

export function setActivePersonCookie(c: Context<HonoEnv>, personId: string): void {
  // httpOnly off so the SPA could read it if needed.
  setCookie(c, ACTIVE_PERSON_COOKIE, personId, {
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}
