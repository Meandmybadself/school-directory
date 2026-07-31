// A faithful preview of the email, produced by the same renderer that builds the
// real thing — not an approximation of it.
//
// It renders into an iframe rather than a div for one specific reason: the email
// HTML sets its own body background and font stack, and dropping that markup
// into the app's document would let the app's stylesheet bleed into it (and vice
// versa). An iframe gives it the isolated document an inbox would.

import { useMemo } from "react";
import type { CalendarEventDTO, NewsletterNode, NewsletterSettingsDTO } from "@sd/shared";
import { renderNewsletterEmailHtml } from "@sd/shared";
import { useDocumentEvents } from "../lib/useCalendarFeeds.js";

export function PreviewPane({
  doc,
  settings,
  title,
  subtitle,
  slug,
  frozenEvents,
}: {
  doc: NewsletterNode;
  settings: NewsletterSettingsDTO;
  title: string;
  subtitle: string | null;
  slug: string;
  /** A sent issue's frozen snapshot. When present the preview shows exactly what
   *  was mailed, rather than a live list its readers never saw. */
  frozenEvents: Record<string, CalendarEventDTO[]> | null;
}) {
  const events = useDocumentEvents(doc, frozenEvents, settings.timeZone);

  const html = useMemo(
    () =>
      renderNewsletterEmailHtml({
        branding: {
          newsletterTitle: settings.newsletterTitle,
          accentColor: settings.accentColor,
          logoUrl: settings.logoUrl,
          footerHtml: settings.footerHtml,
        },
        title: title || "Untitled",
        subtitle,
        doc,
        resolveEvents: (attrs) => events[attrs.blockId] ?? [],
        // The links are inert here; the preview is about layout and copy.
        unsubscribeUrl: "#",
        unsubscribeWording: settings.unsubscribeWording,
        mailingAddress: settings.mailingAddress,
        webUrl: `/n/${slug}`,
        // The school's zone, not the author's — the same one the send uses, so
        // an event near midnight doesn't preview on the wrong day.
        timeZone: settings.timeZone,
      }),
    [doc, events, settings, title, subtitle, slug],
  );

  return (
    <iframe
      className="nlx-preview"
      title="Email preview"
      // sandbox with no allow-scripts: the preview must never execute anything,
      // and there is nothing in a newsletter that needs to.
      sandbox=""
      srcDoc={html}
    />
  );
}
