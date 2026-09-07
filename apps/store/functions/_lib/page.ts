// Shared HTML shell for the server-rendered storefront.
//
// These run as Cloudflare Pages Functions rather than inside the SPA bundle for
// two reasons the newsletter's archive shares — link previews, and not making a
// stranger download an admin bundle to look at a t-shirt — plus one it doesn't:
//
//   THIS IS THE SECOND SURFACE IN THIS PROJECT THAT ASKS TO BE INDEXED. The
//   three members-only SPAs send `noindex`; only apps/home (the apex) and this
//   are meant to be found. Everything apps/home's rules say therefore applies
//   here: a robots.txt, a sitemap, hreflang alternates, and an absolute ban on
//   anything member-private ever appearing. Nothing rendered by these functions
//   comes from anywhere but `publicProductOf` and `orderStatusOf`.
//
// The session cookie is host-only to the API's hostname, so it is NEVER present
// on a navigation to this origin. These pages cannot be — and never try to be —
// auth-aware; the "sign in" link is an unconditional `/app` that hands off to
// the bundle, which resolves who you are.
//
// Unlike the newsletter's functions, these ARE translated: an indexed page that
// claims `hreflang` alternates it doesn't honour is worse than one that claims
// none. Copy comes from the same @sd/shared dictionaries the SPAs use, resolved
// per request by _lib/locale.ts. PRODUCT titles and blurbs are never translated
// — they are admin-entered content (invariant 6).

import { LOCALES, dictionaries, type Locale, type Strings } from "@sd/shared";
import { LANG_PARAM } from "./locale.js";

export interface PagesEnv {
  /** Origin of the API Worker, e.g. https://api-directory.eisenhower.school. */
  API_BASE: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Re-exported so these pages, the cart and the confirmation email all render a
 *  price through one function — see formatMoney in @sd/shared. */
export { formatMoney as money } from "@sd/shared";

/** `t()` for these functions: the same dictionary lookup the SPAs do, minus the
 *  React context they can't have. Falls back through English exactly as
 *  `useI18n`'s does, so a key translated in only one locale still renders. */
export function translator(locale: Locale, school: string) {
  return (key: keyof Strings, vars: Record<string, string> = {}): string => {
    const raw = dictionaries[locale][key] ?? dictionaries.en[key] ?? String(key);
    return raw.replace(/\{(\w+)\}/g, (m, name: string) => vars[name] ?? (name === "school" ? school : m));
  };
}

export interface ShellInput {
  title: string;
  description: string;
  canonical: string;
  locale: Locale;
  css: string;
  body: string;
  /** Absolute image URL for the link preview card, when there is one. */
  image?: string | null;
  /** Sent when a page must not be indexed — a missing product, or any page
   *  reached by a token. */
  noindex?: boolean;
  /** Base URL (no query) the hreflang alternates are built from. Omitted on a
   *  page that has no per-language twin worth advertising. */
  alternatesFor?: string | null;
}

export function shell(input: ShellInput): string {
  const og = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(input.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(input.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(input.canonical)}" />`,
    input.image ? `<meta property="og:image" content="${escapeHtml(input.image)}" />` : "",
    `<meta name="twitter:card" content="${input.image ? "summary_large_image" : "summary"}" />`,
  ]
    .filter(Boolean)
    .join("\n    ");

  // One alternate per locale, plus x-default. Adding a locale to LOCALES adds a
  // line here for free — the same property apps/home's hero has.
  const alternates = input.alternatesFor
    ? [
        ...LOCALES.map(
          (l) =>
            `<link rel="alternate" hreflang="${l}" href="${escapeHtml(
              `${input.alternatesFor}?${LANG_PARAM}=${l}`,
            )}" />`,
        ),
        `<link rel="alternate" hreflang="x-default" href="${escapeHtml(input.alternatesFor)}" />`,
      ].join("\n    ")
    : "";

  return `<!doctype html>
<html lang="${input.locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#f7f7f5" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#16181c" media="(prefers-color-scheme: dark)" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <title>${escapeHtml(input.title)}</title>
    <meta name="description" content="${escapeHtml(input.description)}" />
    <link rel="canonical" href="${escapeHtml(input.canonical)}" />
    ${input.noindex ? '<meta name="robots" content="noindex" />' : ""}
    ${alternates}
    ${og}
    <style>${input.css}</style>
  </head>
  <body>
${input.body}
  </body>
</html>`;
}

/** Fetch JSON from the API. Returns null on any failure so a page can render a
 *  "not found" rather than a stack trace — and so an API blip shows an empty
 *  shop rather than taking the storefront down. */
export async function apiJson<T>(env: PagesEnv, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${env.API_BASE}${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Public, briefly cached. A catalog changes when an admin publishes something,
 *  and a minute of staleness is invisible.
 *
 *  `Vary` names both inputs the response actually depends on: the cookie (a
 *  remembered language) and Accept-Language (a detected one). Without it a
 *  shared cache would hand the next reader the previous one's language — the
 *  same correction apps/home needed when it started reading `sd_lang`. */
export function html(body: string, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, max-age=0, s-maxage=60",
    vary: "Accept-Language, Cookie",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(body, { status, headers });
}

/** Same, but never stored anywhere. MANDATORY for any page whose URL carries a
 *  token: the shared cache is keyed on the URL, so caching an order page would
 *  hand the next reader of that URL somebody else's order. Invariant 15's rule,
 *  and the reason the newsletter's preview pages take the same treatment. */
export function htmlPrivate(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
