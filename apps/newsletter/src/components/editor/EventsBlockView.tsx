// In-editor view of an events block: the live event list the reader will see,
// plus the controls that define the query behind it.
//
// Showing real events (rather than a "[events go here]" placeholder) is the
// point — an admin choosing calendars and a window needs to see what that
// actually produces before mailing it to the whole school.
//
// Two views of the same resolved list, because they answer different questions.
// "Preview" runs the real renderer and shows what the reader gets; it's the
// default, since that's the question an author is usually asking. "List" is the
// compact app-styled version, easier to scan while picking calendars and a
// window. Note they disagree about time zones on purpose — see the TZ comment.

import { useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { formatEventDay, formatEventTime } from "@sd/shared";
import { Icon } from "../Icon.js";
import { useCalendarFeeds, useLiveEvents } from "../../lib/useCalendarFeeds.js";
import { EventsPreview } from "./EventsPreview.js";

const LOOKAHEAD_CHOICES = [7, 14, 30, 60];

// The preview is for the author, so it reads times in the author's own zone.
// The sent email and the archive use the school's configured zone instead, since
// they have no viewer to ask.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const LOCALE = "en-US";

export function EventsBlockView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  extension,
}: NodeViewProps) {
  const blockId = (node.attrs.blockId as string) ?? "blk_preview";
  const calendarIds = (node.attrs.calendarIds as string[]) ?? [];
  const lookaheadDays = (node.attrs.lookaheadDays as number) ?? 14;
  const heading = (node.attrs.heading as string | null) ?? null;
  // Supplied by Editor.tsx from the loaded settings, so the preview's fallback
  // bar colour matches the issue's accent rather than the renderer's default.
  const accentColor = (extension.options.accentColor as string | undefined) ?? "#0068A8";

  const feeds = useCalendarFeeds();
  const events = useLiveEvents(calendarIds, lookaheadDays);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"preview" | "list">("preview");

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
          <div className="nlx-modeswitch sm" role="group" aria-label="Events block view">
            <button type="button" className={`nlx-modebtn${view === "preview" ? " on" : ""}`}
              onClick={() => setView("preview")}>Preview</button>
            <button type="button" className={`nlx-modebtn${view === "list" ? " on" : ""}`}
              onClick={() => setView("list")}>List</button>
          </div>
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

        <div className={`nlx-block-body${view === "preview" ? " pv" : ""}`}>
          {view === "preview" ? (
            <EventsPreview
              blockId={blockId}
              calendarIds={calendarIds}
              lookaheadDays={lookaheadDays}
              heading={heading}
              events={events}
              accentColor={accentColor}
            />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
