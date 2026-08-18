// GET /admin/issues/:id/print — an issue laid out for paper, for the admin who
// is already signed in.
//
// Why this is an SPA route and not a Pages Function like its two public
// siblings: the session cookie is host-only to the API's hostname and is never
// present on a navigation to this origin, so a Function here structurally
// cannot tell an admin from anyone else (see functions/_lib/page.ts). Routing
// the admin's own "view as PDF" through a minted review link instead would
// conflate two independent features and make a one-click action require
// creating a shareable secret first.
//
// It renders through the SAME renderer the public page and the email use
// (invariant 9) — this is its fifth call site, and the fourth that runs it in a
// browser rather than at the edge, exactly as PreviewPane already does for the
// email. Nothing about it is print-specific except the @media print block that
// already lives in NEWSLETTER_WEB_CSS and the dialog fired below.

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CalendarEventDTO, NewsletterIssueDTO, NewsletterSettingsDTO } from "@sd/shared";
import {
  formatIssueDate,
  NEWSLETTER_WEB_CSS,
  renderNewsletterIssuePageHtml,
} from "@sd/shared";
import { api, errorMessage } from "../lib/api.js";
import { brandingOf } from "../lib/branding.js";

export function IssuePrint() {
  const { id = "" } = useParams();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // All three in parallel, then render once: the print dialog must not
        // open over a half-built page.
        const [issueRes, settingsRes, eventsRes] = await Promise.all([
          api.issue(id),
          api.settings(),
          api.issuePreviewEvents(id),
        ]);
        if (!alive) return;
        setHtml(build(issueRes.issue, settingsRes.settings, eventsRes.eventsSnapshot));
      } catch (err) {
        if (alive) setError(errorMessage(err, "Couldn't load that issue."));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // Fires once, after the markup is in the DOM. `requestAnimationFrame` lets the
  // browser lay it out first; without it Safari can open the dialog over a page
  // it hasn't painted. A logo still decoding is the remaining risk, which is why
  // the public print pages wait for `load` instead — here the bundle has already
  // loaded, so there is no load event left to wait for.
  useEffect(() => {
    if (html === null) return;
    const frame = requestAnimationFrame(() => window.print());
    return () => cancelAnimationFrame(frame);
  }, [html]);

  if (error) return <p style={{ padding: 24, fontFamily: "system-ui" }}>{error}</p>;
  if (html === null) return <p style={{ padding: 24, fontFamily: "system-ui" }}>Preparing…</p>;

  return (
    <>
      {/* Scoped to this route by being mounted with it — the screen renders no
          app chrome at all, so there is nothing here for these rules to hit but
          the issue itself. */}
      <style dangerouslySetInnerHTML={{ __html: NEWSLETTER_WEB_CSS }} />
      {/* Same trust level as PreviewPane: this HTML came from the one renderer,
          over a document the API sanitized on write. */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

function build(
  issue: NewsletterIssueDTO,
  settings: NewsletterSettingsDTO,
  events: Record<string, CalendarEventDTO[]>,
): string {
  return renderNewsletterIssuePageHtml({
    branding: brandingOf(settings),
    title: issue.title || "Untitled",
    subtitle: issue.subtitle,
    doc: issue.content,
    resolveEvents: (attrs) => events[attrs.blockId] ?? [],
    dateLabel:
      issue.sentAt !== null
        ? formatIssueDate(issue.sentAt)
        : `Last edited ${formatIssueDate(issue.updatedAt)}`,
    isDraft: issue.status !== "sent",
    // No archive link and no link to a print view: this page IS the print view,
    // and it is reached from the editor rather than from a reader's journey.
    archiveHref: "",
    printHref: "",
    // The school's zone, not the author's — the same one the send uses, so an
    // event near midnight doesn't print on the wrong day.
    timeZone: settings.timeZone,
  });
}
