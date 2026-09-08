// Shared HTML shell for the server-rendered PTO page.
//
// A near-verbatim port of apps/store/functions/_lib/page.ts, and it is here for
// the same three reasons: link previews, not making a stranger download a
// members-only bundle to read about the PTO, and — the one that carries an
// obligation —
//
//   THIS IS THE THIRD SURFACE IN THIS PROJECT THAT ASKS TO BE INDEXED, after
//   apps/home (the apex) and the store's public storefront. The members-only
//   bundles all send `noindex`. Everything apps/home's rules say therefore
//   applies here: a robots.txt, a sitemap, hreflang alternates honoured
//   server-side, and an absolute ban on anything member-private ever appearing.
//
// What makes that ban easy to keep here is worth stating, because it is the
// design and not an accident: NOTHING on this page comes from a member-scoped
// read. The copy is dictionary text, the facts are in `_lib/pto.ts`, and the one
// subrequest is to the ANONYMOUS `/calendar-public/events` — the same read
// apps/home makes, already narrowed by `publicEventOf` (invariant 12). This app
// adds no public projection of its own, and the `pto_*` tables behind the boards
// have none at all.
//
// The session cookie is host-only to the API's hostname, so it is NEVER present
// on a navigation to this origin. This page cannot be — and never tries to be —
// auth-aware; the "sign in" link is an unconditional `/app` that hands off to
// the bundle, which resolves who you are.

import { LOCALES, dictionaries, interpolate, type Locale, type Strings } from "@sd/shared";
import { LANG_PARAM } from "./locale.js";

export interface PagesEnv {
  /** Origin of the API Worker, e.g. https://api-directory.eisenhower.school.
   *  Read for the upcoming-events block and nothing else. */
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

/** `t()` for these functions: the same dictionary lookup the SPAs do, minus the
 *  React context they can't have. Falls back through English exactly as
 *  `useI18n`'s does, so a key translated in only one locale still renders. */
export function translator(locale: Locale, school: string) {
  return (key: keyof Strings, vars: Record<string, string> = {}): string =>
    interpolate(dictionaries[locale][key] ?? dictionaries.en[key] ?? String(key), {
      school,
      ...vars,
    });
}

export interface ShellInput {
  title: string;
  description: string;
  canonical: string;
  locale: Locale;
  css: string;
  body: string;
  /** Base URL (no query) the hreflang alternates are built from. */
  alternatesFor?: string | null;
  noindex?: boolean;
}

export function shell(input: ShellInput): string {
  const og = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(input.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(input.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(input.canonical)}" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].join("\n    ");

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

/** Fetch JSON from the API. Returns null on any failure so the page renders
 *  without its events block rather than not at all — the "degrade to empty"
 *  rule apps/home's `events.ts` states and the storefront follows. */
export async function apiJson<T>(env: PagesEnv, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${env.API_BASE}${path}`, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Public, briefly cached.
 *
 *  `Vary` names both inputs the response actually depends on: the cookie (a
 *  remembered language) and Accept-Language (a detected one). Without it a
 *  shared cache would hand the next reader the previous one's language — the
 *  correction apps/home needed when it started reading `sd_lang`. */
export function html(body: string, status = 200, setCookie?: string): Response {
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, max-age=0, s-maxage=120",
    vary: "Accept-Language, Cookie",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  if (setCookie) headers["set-cookie"] = setCookie;
  return new Response(body, { status, headers });
}
