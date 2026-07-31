// The one newsletter-specific TipTap node: an "upcoming events" block.
//
// It is an ATOM — no children, no editable text. Its event list isn't part of
// the document at all; only the *query* is (which calendars, how far ahead).
// The list is resolved separately: live from the API while drafting, and frozen
// into the issue at send time so the archive keeps showing what was mailed.
// Storing resolved events in the document instead would mean a draft edited over
// several days shipped a stale list.
//
// Being a regular inline-in-flow node rather than a separate "blocks" array
// means an admin can drag it anywhere, use several, and TipTap's own undo/
// selection machinery just works.

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { EVENTS_BLOCK_TYPE } from "@sd/shared";
import { EventsBlockView } from "./EventsBlockView.js";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    eventsBlock: {
      insertEventsBlock: (attrs?: {
        calendarIds?: string[];
        lookaheadDays?: number;
        heading?: string | null;
      }) => ReturnType;
    };
  }
}

/** Random enough to key a snapshot; collision across one document is what
 *  matters, not global uniqueness. */
function newBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 10)}`;
}

export const EventsBlock = Node.create<{ accentColor: string; timeZone: string; calendarUrl: string }>({
  name: EVENTS_BLOCK_TYPE,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  // The node view's email preview renders through the real renderer, which wants
  // the issue's accent for an event whose calendar has no colour of its own, and
  // the school's zone to resolve a fixed date range to the same instants the
  // server will. Passed as extension options because a node view can't reach the
  // screen's loaded settings any other way.
  addOptions() {
    return { accentColor: "#0068A8", timeZone: "America/Chicago", calendarUrl: "" };
  },

  addAttributes() {
    return {
      blockId: {
        default: null,
        // Assigned on insert and then carried through, so the frozen snapshot
        // keeps pointing at the right block even after the document is reordered.
        parseHTML: (el) => el.getAttribute("data-block-id") ?? newBlockId(),
        renderHTML: (attrs) => ({ "data-block-id": attrs.blockId as string }),
      },
      calendarIds: {
        default: [] as string[],
        parseHTML: (el) => {
          const raw = el.getAttribute("data-calendar-ids");
          return raw ? raw.split(",").filter(Boolean) : [];
        },
        renderHTML: (attrs) => ({
          "data-calendar-ids": (attrs.calendarIds as string[]).join(","),
        }),
      },
      lookaheadDays: {
        default: 14,
        parseHTML: (el) => Number(el.getAttribute("data-lookahead")) || 14,
        renderHTML: (attrs) => ({ "data-lookahead": String(attrs.lookaheadDays) }),
      },
      // Both ends together pin the block to fixed dates; either one missing
      // leaves it on the rolling lookaheadDays window. See blockWindow().
      rangeStart: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-range-start"),
        renderHTML: (attrs) =>
          attrs.rangeStart ? { "data-range-start": attrs.rangeStart as string } : {},
      },
      rangeEnd: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-range-end"),
        renderHTML: (attrs) =>
          attrs.rangeEnd ? { "data-range-end": attrs.rangeEnd as string } : {},
      },
      // eventKey handles for events the author removed. Kept in the document so
      // the removal is frozen with the issue and re-applied by the renderer.
      excluded: {
        default: [] as string[],
        parseHTML: (el) => {
          const raw = el.getAttribute("data-excluded");
          return raw ? raw.split("\n").filter(Boolean) : [];
        },
        renderHTML: (attrs) => {
          const list = attrs.excluded as string[];
          return list?.length ? { "data-excluded": list.join("\n") } : {};
        },
      },
      heading: {
        default: "Upcoming events",
        parseHTML: (el) => el.getAttribute("data-heading"),
        renderHTML: (attrs) =>
          attrs.heading ? { "data-heading": attrs.heading as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-events-block]" }];
  },

  // Only used if something serializes the doc to HTML directly; the real render
  // path is @sd/shared's newsletterRender.ts, which reads the JSON.
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-events-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EventsBlockView);
  },

  addCommands() {
    return {
      insertEventsBlock:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: EVENTS_BLOCK_TYPE,
            attrs: {
              blockId: newBlockId(),
              calendarIds: attrs.calendarIds ?? [],
              lookaheadDays: attrs.lookaheadDays ?? 14,
              // A new block starts on the rolling window; the author opts into
              // fixed dates.
              rangeStart: null,
              rangeEnd: null,
              excluded: [],
              heading: attrs.heading ?? "Upcoming events",
            },
          }),
    };
  },
});
