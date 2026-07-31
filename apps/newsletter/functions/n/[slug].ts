// GET /n/:slug — one published issue.
//
// This is the URL printed in every email's "view in browser" link, so it has to
// work with no session, no JavaScript and no prior visit. It renders the stored
// document through @sd/shared's renderNewsletterBodyHtml — the very same
// function that produced the email — over the SAME frozen events snapshot, which
// is what guarantees the archive can't drift from what was mailed.
//
// Only issues whose status is 'sent' are served; a guessed draft slug 404s.

// The footer is the one field an admin writes as HTML; it was sanitized on
// write by @sd/shared's sanitizeFooterHtml, and footerHtmlOf is the single seam
// this page and the email both read it through.
import { footerHtmlOf, NEWSLETTER_WEB_CSS, renderNewsletterBodyHtml } from "@sd/shared";
import type { PublicNewsletterIssueDTO } from "@sd/shared";
import { apiJson, escapeHtml, formatSentAt, html, shell, type PagesEnv } from "../_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const url = new URL(context.request.url);
  const origin = url.origin;
  const slug = String(context.params.slug ?? "");

  const issue = await apiJson<PublicNewsletterIssueDTO>(
    context.env,
    `/newsletter-public/issues/${encodeURIComponent(slug)}`,
  );

  if (!issue) {
    return html(
      shell({
        title: "Not found",
        description: "This newsletter issue isn't available.",
        canonical: `${origin}/n/${escapeHtml(slug)}`,
        accentColor: "#0068A8",
        css: NEWSLETTER_WEB_CSS,
        noindex: true,
        body: `    <div class="nl-wrap">
      <div class="nl-empty">
        <p>That issue isn't available.</p>
        <p><a href="/">See all issues</a></p>
      </div>
    </div>`,
      }),
      404,
    );
  }

  const { branding } = issue;
  const content = renderNewsletterBodyHtml(
    issue.content,
    (attrs) => issue.eventsSnapshot[attrs.blockId] ?? [],
    { mode: "web", accentColor: branding.accentColor },
  );

  const masthead = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${escapeHtml(branding.newsletterTitle)}</div>`;

  const body = `    <div class="nl-wrap">
      <div class="nl-masthead"><a href="/" style="text-decoration:none">${masthead}</a></div>
      <article class="nl-card">
        <h1 class="nl-title">${escapeHtml(issue.title)}</h1>
        ${issue.subtitle ? `<p class="nl-subtitle">${escapeHtml(issue.subtitle)}</p>` : ""}
        <p class="nl-date">${escapeHtml(formatSentAt(issue.sentAt))}</p>
        <div class="nl-body">
${content}
        </div>
        <div class="nl-foot">
          ${footerHtmlOf(branding)}
          <p style="margin:8px 0 0"><a href="/">See all issues</a></p>
        </div>
      </article>
    </div>`;

  return html(
    shell({
      title: `${issue.title} — ${branding.newsletterTitle}`,
      description: issue.subtitle ?? issue.excerpt,
      canonical: `${origin}/n/${issue.slug}`,
      accentColor: branding.accentColor,
      css: NEWSLETTER_WEB_CSS,
      image: branding.logoUrl,
      body,
    }),
  );
};
