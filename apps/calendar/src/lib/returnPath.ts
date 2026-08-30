// Remember where someone was when they went off to sign in.
//
// The magic link can only come back to an ORIGIN: `resolveReturnTo` in the API
// validates `returnTo` against ALLOWED_ORIGINS by exact match, which is the same
// list that defines the CORS trust boundary. Loosening it to accept paths would
// widen a security-relevant allowlist to solve a navigation problem, so the path
// is kept on this side instead — the browser that started the sign-in is the one
// that comes back, and sessionStorage is scoped to exactly that tab.
//
// Only pages that explicitly ask for it are remembered (today: an event page,
// which is where a volunteer sheet is signed up on). The stash is one-shot and
// time-boxed, so a link clicked tomorrow cannot yank someone away from the
// agenda they actually opened.

const KEY = "sd_cal_return_path";
/** Long enough to find the email, short enough that a stale entry expires. */
const TTL_MS = 30 * 60 * 1000;

interface Stashed {
  path: string;
  at: number;
}

/** Same-origin paths only. `startsWith("/")` alone is NOT enough: a
 *  protocol-relative "//evil.example/steal" also starts with a slash and a
 *  browser resolves it to another origin. Requiring the second character to be
 *  something other than `/` or `\` (which some parsers fold to `/`) is what
 *  keeps this from becoming the open redirect the API's origin allowlist exists
 *  to prevent. */
function isSameOriginPath(path: string): boolean {
  return path.startsWith("/") && path[1] !== "/" && path[1] !== "\\";
}

/** Remember a same-origin path to return to after the magic link lands. */
export function rememberReturnPath(path: string): void {
  if (!isSameOriginPath(path)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: Date.now() } satisfies Stashed));
  } catch {
    /* private mode / quota — returning to `/` is an acceptable outcome */
  }
}

/** Take the remembered path, if there is a fresh one. Always clears. */
export function takeReturnPath(): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { path, at } = JSON.parse(raw) as Stashed;
    // Re-checked on read as well as on write: sessionStorage is writable by any
    // script on this origin, so what comes back out is not necessarily what
    // `rememberReturnPath` put in.
    if (typeof path !== "string" || !isSameOriginPath(path)) return null;
    if (!Number.isFinite(at) || Date.now() - at > TTL_MS) return null;
    return path;
  } catch {
    return null;
  }
}
