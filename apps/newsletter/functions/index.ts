// GET / — the public archive index.
//
// Server-rendered on this origin (see functions/_lib/page.ts for why), reading
// the same public endpoint the "latest issue" card on the directory's Home
// screen uses.

import { NEWSLETTER_WEB_CSS } from "@sd/shared";
import type { PublicNewsletterArchiveDTO } from "@sd/shared";
import { apiJson, escapeHtml, formatIssueDate, html, shell, type PagesEnv } from "./_lib/page.js";

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
    footerHtml: "",
    calendarUrl: "",
  };

  const masthead = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.newsletterTitle)}" />`
    : `<div class="nl-masthead-title">${escapeHtml(branding.newsletterTitle)}</div>`;

  const items = issues
    .map(
      (issue) => `      <a class="nl-archive-item" href="/n/${escapeHtml(issue.slug)}">
        <span class="nl-archive-date">${escapeHtml(formatIssueDate(issue.sentAt))}</span>
        <h2>${escapeHtml(issue.title)}</h2>
        <p>${escapeHtml(issue.subtitle ?? issue.excerpt)}</p>
      </a>`,
    )
    .join("\n");

  // Above the issue list, not below it: the archive can run to dozens of cards,
  // and a reader who has decided they want this shouldn't have to scroll past
  // everything they haven't read yet to act on it. Shown even when the archive
  // is empty — a school that hasn't sent its first issue is exactly when
  // collecting addresses matters most.
  const subscribe = `      <a class="nl-subscribe-cta" href="/subscribe">
        <strong>Get this by email &rarr;</strong>
        <span>Free, open to anyone, and you can unsubscribe from any issue.</span>
      </a>`;

  const body = `    <div class="nl-wrap">
      <div class="nl-masthead">${masthead}</div>
${subscribe}
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
