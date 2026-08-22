// eisenhower.school — the public front door.
//
// This hostname used to be a Cloudflare redirect rule pointing at the school
// district's own site. It is now one server-rendered page that says what the
// PTO runs here and asks a family to join it. Two consequences worth knowing:
//
//  - It is the ONLY surface in this project that wants to be indexed. The three
//    SPAs send `noindex` because they are members-only; this page is the thing a
//    search for "eisenhower school directory" should find, so it ships a
//    robots.txt, a sitemap and hreflang alternates for all four languages.
//  - People still arrive here looking for the school district's site, because
//    that is where this domain took them for years. Every rendering carries a
//    link out to it in the header — see `landingSchoolSiteLabel`.
//
// No session and no D1. There is exactly ONE subrequest, and it is worth
// knowing where: the landing page reads the next few events off the anonymous
// `/calendar-public/events` so the front door can show what is coming up
// without a copy of the dates going stale here. It is edge-cached, it times
// out fast, and every failure mode resolves to "no events block" rather than to
// a broken page — see `events.ts`. Everything else on the page is still a pure
// function of the requested URL, the Accept-Language header and the `sd_lang`
// cookie — the last of which is the ONLY state this page keeps, and holds
// nothing but a choice of language. See `locale.ts`.

import { LOCALES } from "@sd/shared";
import type { Env } from "./env.js";
import { langCookie, resolveLocale } from "./locale.js";
import { renderHome, renderNotFound } from "./page.js";

/** Vanity paths people type or get told over the phone ("go to
 *  eisenhower.school slash calendar"). Each hands off to the app that owns it,
 *  carrying the language along. */
const SHORTCUTS: Record<string, (env: Env) => string> = {
  "/directory": (env) => `${trimSlash(env.DIRECTORY_URL)}/`,
  "/calendar": (env) => `${trimSlash(env.CALENDAR_URL)}/`,
  "/newsletter": (env) => `${trimSlash(env.NEWSLETTER_URL)}/`,
  "/sign-in": (env) => `${trimSlash(env.DIRECTORY_URL)}/sign-in`,
  "/subscribe": (env) => `${trimSlash(env.NEWSLETTER_URL)}/subscribe`,
};

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function html(body: string, status = 200, setCookie?: string): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    // Rendering costs nothing and the answer varies by Accept-Language and by
    // the remembered-language cookie, neither of which Cloudflare's edge cache
    // keys on. Revalidating every time is simpler than a Vary the cache would
    // ignore — and with a cookie in the mix, storing a shared copy would mean
    // serving one reader's language to the next.
    "cache-control": "private, max-age=0, must-revalidate",
    vary: "Accept-Language, Cookie",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  if (setCookie) headers.append("set-cookie", setCookie);
  return new Response(body, { status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // www → apex, path and query preserved. Kept here rather than in a
    // Cloudflare redirect rule so the whole routing story for this hostname
    // lives in one file that CI deploys and the tests below cover.
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    const { locale, explicit } = resolveLocale(url, request);

    if (path === "/robots.txt") {
      return text(`User-agent: *\nAllow: /\nSitemap: ${trimSlash(env.SITE_ORIGIN)}/sitemap.xml\n`);
    }

    if (path === "/sitemap.xml") {
      return sitemap(env);
    }

    const shortcut = SHORTCUTS[path];
    if (shortcut) {
      return Response.redirect(`${shortcut(env)}?lang=${locale}`, 302);
    }

    if (path !== "/") {
      return html(renderNotFound(env, locale), 404);
    }

    // Remember the choice, but only when `?lang=` made it. A language merely
    // DETECTED from the header is never written back, so detection can't
    // promote itself into a preference the reader never stated — see
    // `resolveLocale`.
    return html(await renderHome(env, locale, explicit), 200, explicit ? langCookie(locale) : undefined);
  },
};

function text(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}

/** One entry per language, since each `?lang=` URL is a distinct document with
 *  its own `hreflang` and its own canonical. */
function sitemap(env: Env): Response {
  const origin = trimSlash(env.SITE_ORIGIN);
  const urls = [`${origin}/`, ...LOCALES.map((l) => `${origin}/?lang=${l}`)]
    .map((loc) => `  <url><loc>${loc.replace(/&/g, "&amp;")}</loc></url>`)
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}
