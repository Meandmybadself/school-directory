// The reader-facing subset of the newsletter settings.
//
// The API has its own `brandingOf` (apps/api/src/lib/newsletter.ts) that builds
// the same shape for the public archive; this is the client-side twin, used by
// the composer's email preview and by the print view. Kept as a named function
// rather than inlined at each call site so "which settings does a reader see?"
// has one answer here — sender identity (senderName, senderEmail, replyTo) is
// admin configuration and never belongs in a rendered issue.

import type { NewsletterBrandingDTO, NewsletterSettingsDTO } from "@sd/shared";

export function brandingOf(settings: NewsletterSettingsDTO): NewsletterBrandingDTO {
  return {
    newsletterTitle: settings.newsletterTitle,
    accentColor: settings.accentColor,
    logoUrl: settings.logoUrl,
    footerHtml: settings.footerHtml,
    calendarUrl: settings.calendarUrl,
  };
}
