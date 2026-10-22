// Plain forwarding aliases (admin@, pto@) on the school's domain.
//
// An Email Routing RULE forwards to at most one verified destination, so a
// multi-recipient alias routes to this Worker instead and fans out through
// `message.forward()` (src/email.ts). Which local parts forward where lives in
// the EMAIL_FORWARDS secret as JSON — `{"pto": ["a@…", "b@…"], "admin": […]}`
// — a SECRET rather than a wrangler.toml var because this repo is public and
// the values are board members' personal addresses.
//
// Every destination must be a VERIFIED Email Routing destination address
// (created on the account, holder clicked Cloudflare's verification link) or
// its forward() throws. The handler skips a failed destination and delivers
// to the rest — an alias must not go dark because one member hasn't clicked
// verify yet.

import type { Env } from "../env.js";

/** The forwarding map out of the EMAIL_FORWARDS secret. Absent-means-off,
 *  like every optional secret here; malformed JSON is treated as absent and
 *  logged, never thrown — a config slip must not bounce the school's mail. */
export function parseForwards(raw: string | undefined): Record<string, string[]> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    const map: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(v)) {
      const list = Array.isArray(val) ? val.filter((d): d is string => typeof d === "string" && d.includes("@")) : [];
      if (list.length) map[key.toLowerCase()] = list;
    }
    return map;
  } catch (err) {
    console.error(`[email] EMAIL_FORWARDS is not valid JSON: ${String(err).slice(0, 120)}`);
    return {};
  }
}

/** Where mail to this envelope recipient forwards, or null when the address
 *  isn't a forwarding alias (and falls through to the lost & found intake). */
export function forwardsFor(env: Env, rcptTo: string): string[] | null {
  const local = rcptTo.split("@")[0]?.trim().toLowerCase() ?? "";
  return parseForwards(env.EMAIL_FORWARDS)[local] ?? null;
}
