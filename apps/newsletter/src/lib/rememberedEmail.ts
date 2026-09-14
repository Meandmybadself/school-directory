// The address the last successful sign-in used, kept so the sign-in form can
// offer it back instead of making a parent retype it on every expired session.
//
// It is a cookie on THIS app's own origin, written by the app, not by the API:
// `sd_session` is host-only to the API's hostname, so nothing the API sets is
// readable from a form on a sibling subdomain. Host-only here too (no `Domain`),
// like `sd_session` and the front door's `sd_lang` — each app records the
// address the moment it sees a session, so the five copies fill in on their own
// without one cookie riding along to every host. Not written while
// masquerading: the admin's own form would otherwise offer them the member's
// address next time.
const NAME = "sd_email";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function rememberEmail(email: string): void {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${NAME}=${encodeURIComponent(email)}; Max-Age=${ONE_YEAR}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // Cookies disabled: the form simply starts empty.
  }
}

export function rememberedEmail(): string {
  try {
    for (const part of document.cookie.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (k === NAME) return decodeURIComponent(rest.join("="));
    }
  } catch {
    // Cookies unreadable: same answer as none saved.
  }
  return "";
}
