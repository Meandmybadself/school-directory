// Shared HTML shell for the server-rendered public pages.
//
// These run as Cloudflare Pages Functions rather than inside the SPA bundle for
// one reason: link previews. A newsletter gets pasted into text messages, class
// Facebook groups and Slack, and every crawler that builds those previews reads
// the initial HTML without executing JavaScript. A client-rendered page shows
// them an empty document. Rendering here also means a reader opening an issue
// from their inbox never downloads the ~590 kB authoring bundle.
//
// The session cookie is host-only to the API's hostname, so it is NEVER present
// on a navigation to this origin. These pages therefore cannot be — and never
// try to be — auth-aware. That is also why the footer link below is an
// unconditional, static "/app" rather than a "signed in as…" affordance: it
// hands off to the SPA, which resolves who you are and routes accordingly. It
// exists because these pages own `/`, so without it the bare origin is a dead
// end with no way into the app at all.

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

export interface ShellInput {
  title: string;
  description: string;
  canonical: string;
  accentColor: string;
  css: string;
  body: string;
  /** Absolute image URL for the link preview card, when there is one. */
  image?: string | null;
  /** Sent when an issue can't be found, so crawlers don't index a 404. */
  noindex?: boolean;
}

export function shell(input: ShellInput): string {
  const og = [
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${escapeHtml(input.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(input.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(input.canonical)}" />`,
    input.image ? `<meta property="og:image" content="${escapeHtml(input.image)}" />` : "",
    `<meta name="twitter:card" content="${input.image ? "summary_large_image" : "summary"}" />`,
  ]
    .filter(Boolean)
    .join("\n    ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#ffffff" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <title>${escapeHtml(input.title)}</title>
    <meta name="description" content="${escapeHtml(input.description)}" />
    <link rel="canonical" href="${escapeHtml(input.canonical)}" />
    ${input.noindex ? '<meta name="robots" content="noindex" />' : ""}
    ${og}
    <style>
      :root { --nl-accent: ${escapeHtml(input.accentColor)}; }
      ${input.css}
    </style>
  </head>
  <body>
${input.body}
    <div class="nl-site-foot"><a href="/app">Members: sign in</a></div>
  </body>
</html>`;
}

/** Fetch JSON from the API. Returns null on any failure so a page can render a
 *  "not found" rather than a stack trace. */
export async function apiJson<T>(env: PagesEnv, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${env.API_BASE}${path}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** POST JSON to the API and report only whether it was accepted.
 *
 *  Server-to-server from the Function, so these calls never touch CORS and
 *  never carry a cookie — which is the point on the subscribe path: the API's
 *  public routes are the trust boundary, and this is just a browser-friendly
 *  front for them. Returns null on transport failure so a page can say "that
 *  didn't work" rather than 500. */
export async function apiPost<T>(
  env: PagesEnv,
  path: string,
  body: unknown,
): Promise<{ status: number; data: T | null } | null> {
  try {
    const res = await fetch(`${env.API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = res.headers.get("content-type")?.includes("application/json")
      ? ((await res.json()) as T)
      : null;
    return { status: res.status, data };
  } catch {
    return null;
  }
}

export function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Short public cache: an issue is immutable once sent, but the archive
      // index changes whenever one is, and a minute of staleness is invisible.
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}

/** Same, but never stored anywhere. For pages whose URL contains a token or
 *  whose body names an address: the shared cache above is keyed on the URL, so
 *  caching a confirmation page would hand the next reader of that URL somebody
 *  else's email address — and would let an already-consumed link keep rendering
 *  as if it were live. */
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
