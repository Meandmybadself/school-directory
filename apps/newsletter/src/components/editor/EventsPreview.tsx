// The events block as the email will actually draw it.
//
// The compact list in EventsBlockView answers "which events did my query pick?".
// This answers the different question "what will the reader see?" — and the only
// honest way to answer it is to run the real renderer, so this builds a one-block
// document and hands it to renderNewsletterBodyHtml in email mode. Same code path
// the sent email and the archive page take (invariant 9); nothing here re-draws
// an event by hand.
//
// It renders into an iframe for the reason PreviewPane documents: the email
// markup carries its own font stack and background, and the app's stylesheet has
// rules for h2/table/div that would bleed into it. An iframe gives it the
// isolated document an inbox would.
//
// Times use the renderer's default zone, not the author's — matching PreviewPane,
// and matching what the email does when it has no viewer to ask.

import { useCallback, useMemo, useRef, useState } from "react";
import type { CalendarEventDTO, NewsletterNode } from "@sd/shared";
import { EVENTS_BLOCK_TYPE, renderNewsletterBodyHtml } from "@sd/shared";

/** Mirrors the email's content cell: a 600px paper column with the same 28px
 *  gutters, so at a wide editor width this is pixel-for-pixel the email, and
 *  narrower it reflows the way a phone would. */
function frameDoc(body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#FFFFFF;-webkit-text-size-adjust:100%">
<div style="max-width:600px;padding:2px 28px;box-sizing:border-box">${body}</div>
</body></html>`;
}

export function EventsPreview({
  blockId,
  calendarIds,
  lookaheadDays,
  rangeStart,
  rangeEnd,
  excluded,
  heading,
  events,
  accentColor,
  timeZone,
}: {
  blockId: string;
  calendarIds: string[];
  lookaheadDays: number;
  rangeStart: string | null;
  rangeEnd: string | null;
  excluded: string[];
  heading: string | null;
  /** null while the query is still resolving. */
  events: CalendarEventDTO[] | null;
  accentColor: string;
  timeZone: string;
}) {
  // `excluded` rides in the attrs rather than being filtered out of `events`
  // first: the renderer is what applies removals for the email and the archive,
  // so letting it do the same here is what keeps this preview honest.
  const html = useMemo(() => {
    const doc: NewsletterNode = {
      type: "doc",
      content: [
        {
          type: EVENTS_BLOCK_TYPE,
          attrs: { blockId, calendarIds, lookaheadDays, rangeStart, rangeEnd, excluded, heading },
        },
      ],
    };
    return frameDoc(
      renderNewsletterBodyHtml(doc, () => events ?? [], {
        mode: "email",
        accentColor,
        timeZone,
      }),
    );
  }, [
    blockId, calendarIds, lookaheadDays, rangeStart, rangeEnd, excluded,
    heading, events, accentColor, timeZone,
  ]);

  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(96);

  // srcDoc loads asynchronously, so onLoad is the trigger; reading scrollHeight
  // needs allow-same-origin, which is safe only because allow-scripts is absent —
  // nothing in the frame can run, so it can't use the origin it keeps.
  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 0;
    if (h > 0) setHeight(h);
  }, []);

  if (events === null) return <div className="nlx-block-empty">Loading events…</div>;

  return (
    <iframe
      ref={ref}
      className="nlx-block-preview"
      title="Events preview"
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height }}
      onLoad={measure}
    />
  );
}
