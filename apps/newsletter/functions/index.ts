// GET / — the public archive index.
//
// Server-rendered on this origin (see functions/_lib/page.ts for why), reading
// the same public endpoint the "latest issue" card on the directory's Home
// screen uses.

import { NEWSLETTER_WEB_CSS } from "@sd/shared";
import type { PublicNewsletterArchiveDTO } from "@sd/shared";
import { apiJson, escapeHtml, formatSentAt, html, shell, type PagesEnv } from "./_lib/page.js";

export const onRequestGet: PagesFunction<PagesEnv> = async (context) => {
  const origin = new URL(context.request.url).origin;
  const data = await apiJson<PublicNewsletterArchiveDTO>(context.env, "/newsletter-public/issues");

  // A failed API call and an empty archive look the same to a reader; both mean
  // "nothing to read here yet", and neither is worth a stack trace.
  const issues = data?.issues ?? [];
  const branding = data?.branding ?? {
    newsletterTitle: "Newsletter",
    accentColor: "#0068A8",
    logoUrl: null,
    footerText: "",
    footerHtml: "",
  };

  const masthead = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${escapeHtml(branding.newsletterTitle)}</div>`;

  const items = issues
    .map(
      (issue) => `      <a class="nl-archive-item" href="/n/${escapeHtml(issue.slug)}">
        <span class="nl-archive-date">${escapeHtml(formatSentAt(issue.sentAt))}</span>
        <h2>${escapeHtml(issue.title)}</h2>
        <p>${escapeHtml(issue.subtitle ?? issue.excerpt)}</p>
      </a>`,
    )
    .join("\n");

  const body = `    <div class="nl-wrap">
      <div class="nl-masthead">${masthead}</div>
${issues.length === 0 ? '      <div class="nl-empty">No issues have been published yet.</div>' : items}
    </div>`;

  return html(
    shell({
      title: branding.newsletterTitle,
      description: `Past issues of the ${branding.newsletterTitle}.`,
      canonical: `${origin}/`,
      accentColor: branding.accentColor,
      css: NEWSLETTER_WEB_CSS,
      image: branding.logoUrl,
      body,
    }),
  );
};
