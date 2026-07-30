// In-editor view of an events block: the live event list the reader will see,
// plus the controls that define the query behind it.
//
// Showing real events (rather than a "[events go here]" placeholder) is the
// point — an admin choosing calendars and a window needs to see what that
// actually produces before mailing it to the whole school.

import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { formatEventDay, formatEventTime } from "@sd/shared";
import { Icon } from "../Icon.js";
import { useCalendarFeeds, useLiveEvents } from "../../lib/useCalendarFeeds.js";

const LOOKAHEAD_CHOICES = [7, 14, 30, 60];

// The preview is for the author, so it reads times in the author's own zone.
// The sent email and the archive use the school's configured zone instead, since
// they have no viewer to ask.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCALE = "en-US";

export function EventsBlockView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const calendarIds = (node.attrs.calendarIds as string[]) ?? [];
  const lookaheadDays = (node.attrs.lookaheadDays as number) ?? 14;
  const heading = (node.attrs.heading as string | null) ?? null;

  const feeds = useCalendarFeeds();
  const events = useLiveEvents(calendarIds, lookaheadDays);
  const [open, setOpen] = useState(false);

  const toggleCalendar = (id: string) => {
    const next = calendarIds.includes(id)
      ? calendarIds.filter((c) => c !== id)
      : [...calendarIds, id];
    updateAttributes({ calendarIds: next });
  };

  // Empty means "every calendar" — the same convention the API uses — so the
  // label has to say that rather than "0 calendars".
  const calendarLabel =
    calendarIds.length === 0
      ? "All calendars"
      : calendarIds.length === 1
        ? (feeds.find((f) => f.id === calendarIds[0])?.name ?? "1 calendar")
        : `${calendarIds.length} calendars`;

  return (
    <NodeViewWrapper>
      <div className={`nlx-block${selected ? " sel" : ""}`} contentEditable={false}>
        <div className="nlx-block-bar">
          <Icon name="calendar" size={15} stroke={2} />
          <span className="nlx-block-kind">Upcoming events</span>
          <span className="nlx-block-note">{calendarLabel} · next {lookaheadDays} days</span>
          <div style={{ flex: 1 }} />
          <button type="button" className="nlx-mini" onClick={() => setOpen((v) => !v)}>
            {open ? "Done" : "Configure"}
          </button>
          <button type="button" className="nlx-mini danger" onClick={deleteNode} title="Remove block">
            <Icon name="x" size={14} stroke={2.2} />
          </button>
        </div>

        {open && (
          <div className="nlx-block-config">
            <label className="sd-label">Heading</label>
            <input
              className="sd-input"
              value={heading ?? ""}
              placeholder="No heading"
              onChange={(e) => updateAttributes({ heading: e.target.value || null })}
            />

            <label className="sd-label" style={{ marginTop: 12 }}>Show the next</label>
            <div className="nlx-chips">
              {LOOKAHEAD_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`nlx-chip${d === lookaheadDays ? " on" : ""}`}
                  onClick={() => updateAttributes({ lookaheadDays: d })}
                >
                  {d} days
                </button>
              ))}
            </div>

            <label className="sd-label" style={{ marginTop: 12 }}>Calendars</label>
            <div className="nlx-chips">
              <button
                type="button"
                className={`nlx-chip${calendarIds.length === 0 ? " on" : ""}`}
                onClick={() => updateAttributes({ calendarIds: [] })}
              >
                All
              </button>
              {feeds.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`nlx-chip${calendarIds.includes(f.id) ? " on" : ""}`}
                  onClick={() => toggleCalendar(f.id)}
                >
                  <span className="nlx-dot" style={{ background: f.color }} />
                  {f.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="nlx-block-body">
          {events === null && <div className="nlx-block-empty">Loading events…</div>}
          {events?.length === 0 && (
            <div className="nlx-block-empty">
              No events in this window. The block will say so in the sent issue.
            </div>
          )}
          {events?.map((e) => (
            <div key={e.id} className="nlx-event" style={{ borderLeftColor: e.source.color }}>
              <div className="nlx-event-title">{e.title}</div>
              <div className="nlx-event-meta">
                {[formatEventDay(e, LOCALE, TZ), formatEventTime(e, LOCALE, TZ)]
                  .filter(Boolean)
                  .join(" · ")}
                {e.location ? ` — ${e.location}` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
