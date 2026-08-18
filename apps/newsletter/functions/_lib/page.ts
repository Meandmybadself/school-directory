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
//
// The footer copy here is English, unlike its counterpart in the SPAs, because
// these pages have no i18n at all: they are rendered before any client runs, so
// there is nothing to read a language preference from and no `?lang=` handling.
// Translating them means giving these functions a locale of their own — worth
// doing, but a larger change than duplicating two lines.

import { formatIssueDate, NEWSLETTER_WEB_CSS, renderNewsletterIssuePageHtml } from "@sd/shared";
import type { NewsletterIssuePageDTO } from "@sd/shared";

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
  /** Opens the browser's print dialog on load — this project's "save as PDF".
   *  There is no PDF renderer here and adding one would be a second place for a
   *  newsletter's look to drift from the email (invariant 9), so the browser's
   *  own print engine does the job. The markup is identical either way; the
   *  @media print block in NEWSLETTER_WEB_CSS does the rest. */
  print?: boolean;
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
    <div class="nl-site-foot">
      <div>Site built by the Eisenhower PTO.</div>
      <div>Feedback? Email <a href="mailto:admin@eisenhower.school">admin@eisenhower.school</a></div>
      <div style="margin-top:10px"><a href="/app">Members: sign in</a></div>
    </div>
${input.print ? PRINT_SCRIPT : ""}
  </body>
</html>`;
}

/** Fires the print dialog once the page has settled.
 *
 *  On `load` rather than immediately: a masthead logo that hasn't decoded yet
 *  prints as a gap, and `load` is the one event that waits for images. The
 *  optional chaining is for the rare embedded viewer that exposes no `print`. */
const PRINT_SCRIPT = `    <script>addEventListener("load",function(){window.print&&window.print()})</script>`;

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

/** Re-exported so these pages and the SPA's print view can't drift into two
 *  date formats. Lives in @sd/shared next to the renderer that lays out the
 *  page it appears on. */
export { formatIssueDate };

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

export interface IssuePageOptions {
  /** API path to read the issue from — by public slug or by review token. */
  apiPath: string;
  canonical: string;
  /** "" on a token-reached page: it has no archive entry to go back to. */
  archiveHref: string;
  /** "" on a print view, so the printed page carries no link to itself. */
  printHref: string;
  print: boolean;
  /** false ⇒ htmlPrivate(), which is MANDATORY when the URL contains a token.
   *  A shared cache is keyed on the URL, so caching one would let a revoked link
   *  keep being served from the edge after DELETE …/preview-link — silently
   *  undoing the one guarantee the feature makes. It also keeps the token out of
   *  referrers and out of search indexes. */
  cacheable: boolean;
  /** What the 404 page says when the issue isn't there. */
  notFoundHint: string;
}

/** Load one issue and render it as a whole document, or as a 404.
 *
 *  The four issue-page routes — public and review-token, each with a print
 *  twin — differ only in the fields above. Everything after the fetch is
 *  identical, which is exactly what keeps them from drifting back into four
 *  near-copies of the same template as the page grows. */
export async function renderIssuePage(
  env: PagesEnv,
  opts: IssuePageOptions,
): Promise<Response> {
  const send = opts.cacheable ? html : htmlPrivate;
  const issue = await apiJson<NewsletterIssuePageDTO>(env, opts.apiPath);

  if (!issue) {
    return send(
      shell({
        title: "Not found",
        description: "This newsletter issue isn't available.",
        canonical: opts.canonical,
        accentColor: "#0068A8",
        css: NEWSLETTER_WEB_CSS,
        noindex: true,
        body: `    <div class="nl-wrap">
      <div class="nl-empty">
        <p>${escapeHtml(opts.notFoundHint)}</p>
        ${opts.archiveHref ? `<p><a href="${escapeHtml(opts.archiveHref)}">See all issues</a></p>` : ""}
      </div>
    </div>`,
      }),
      404,
    );
  }

  const { branding } = issue;
  const isDraft = issue.status !== "sent";
  const body = renderNewsletterIssuePageHtml({
    branding,
    title: issue.title,
    subtitle: issue.subtitle,
    doc: issue.content,
    resolveEvents: (attrs) => issue.eventsSnapshot[attrs.blockId] ?? [],
    dateLabel:
      issue.sentAt !== null
        ? formatIssueDate(issue.sentAt)
        : `Last edited ${formatIssueDate(issue.updatedAt)}`,
    isDraft,
    archiveHref: opts.archiveHref,
    printHref: opts.printHref,
  });

  return send(
    shell({
      title: `${issue.title} — ${branding.newsletterTitle}`,
      description: issue.subtitle ?? issue.excerpt,
      canonical: opts.canonical,
      accentColor: branding.accentColor,
      css: NEWSLETTER_WEB_CSS,
      image: branding.logoUrl,
      // Exactly one of these four pages is meant to be indexed: the plain,
      // cacheable page of a sent issue. A print view is a second rendering of a
      // page that already exists, and anything reached by a token is nobody's
      // business but the holder's — including after the issue is sent, which is
      // why this keys on `cacheable` rather than on `isDraft`. htmlPrivate()
      // already sends `x-robots-tag` for those, and the header is authoritative;
      // this is the belt to its braces, and it costs a boolean.
      noindex: opts.print || !opts.cacheable,
      print: opts.print,
      body,
    }),
  );
}
