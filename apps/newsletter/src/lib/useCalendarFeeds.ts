// Calendar list + live event lookup for events blocks.
//
// Every events block needs the same list of pickable calendars, and several
// blocks often ask for overlapping event windows. Fetching per block would mean
// one request per keystroke on the lookahead input, so both are cached at module
// scope: the feed list once, and event queries by their (calendars, window) key.

import { useEffect, useState } from "react";
import type {
  CalendarEventDTO,
  CalendarFeedDTO,
  NewsletterEventsBlockAttrs,
  NewsletterNode,
} from "@sd/shared";
import { blockWindow, collectEventsBlocks, hasFixedRange } from "@sd/shared";
import { api } from "./api.js";

let feedsPromise: Promise<CalendarFeedDTO[]> | null = null;

function loadFeeds(): Promise<CalendarFeedDTO[]> {
  feedsPromise ??= api
    .calendarFeeds()
    .then((r) => r.sources)
    .catch(() => []);
  return feedsPromise;
}

/** Every calendar an events block can draw from — imported feeds and managed
 *  calendars alike, exactly as the calendar app's filter bar sees them. */
export function useCalendarFeeds(): CalendarFeedDTO[] {
  const [feeds, setFeeds] = useState<CalendarFeedDTO[]>([]);
  useEffect(() => {
    let alive = true;
    void loadFeeds().then((f) => {
      if (alive) setFeeds(f);
    });
    return () => {
      alive = false;
    };
  }, []);
  return feeds;
}

const eventCache = new Map<string, Promise<CalendarEventDTO[]>>();

/** What a block asks the calendar for. `excluded` is deliberately absent: it
 *  changes what's DRAWN, not what's fetched, so removing an event must not
 *  invalidate the cache or re-query. */
type BlockQuery = Pick<
  NewsletterEventsBlockAttrs,
  "calendarIds" | "lookaheadDays" | "rangeStart" | "rangeEnd"
>;

/** A rolling window is keyed by its length rather than by the resolved instants,
 *  so two blocks asking for "next 14 days" a second apart still share one fetch.
 *  A fixed range is keyed by its dates, which are already stable. */
function queryKey(q: BlockQuery): string {
  const window = hasFixedRange(q) ? `${q.rangeStart}..${q.rangeEnd}` : `d${q.lookaheadDays}`;
  return `${[...q.calendarIds].sort().join(",")}|${window}`;
}

function fetchEvents(q: BlockQuery, timeZone: string): Promise<CalendarEventDTO[]> {
  const key = queryKey(q);
  let promise = eventCache.get(key);
  if (!promise) {
    // The same helper the server calls, against the school's zone rather than
    // the author's, so the preview and the sent issue select the same events.
    const { from, to } = blockWindow(q, new Date().toISOString(), timeZone);
    promise = api
      .calendarEvents({ from, to, calendars: q.calendarIds, limit: 50 })
      .then((r) => r.events)
      .catch(() => []);
    eventCache.set(key, promise);
  }
  return promise;
}

/** Resolve every events block in a document at once, for the preview pane.
 *
 *  `frozen` short-circuits the whole thing: a sent issue already has its
 *  snapshot, and previewing it live would show something its readers never saw. */
export function useDocumentEvents(
  doc: NewsletterNode,
  frozen: Record<string, CalendarEventDTO[]> | null,
  timeZone: string,
): Record<string, CalendarEventDTO[]> {
  const [resolved, setResolved] = useState<Record<string, CalendarEventDTO[]>>({});
  const blocks = frozen ? [] : collectEventsBlocks(doc);
  // Re-resolve only when a block's query actually changes, not on every keystroke.
  const signature = blocks.map((b) => `${b.blockId}:${queryKey(b)}`).join(";");

  useEffect(() => {
    if (frozen) return;
    let alive = true;
    void Promise.all(
      blocks.map(async (b) => [b.blockId, await fetchEvents(b, timeZone)] as const),
    ).then((entries) => {
      if (alive) setResolved(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, frozen, timeZone]);

  return frozen ?? resolved;
}

/** Live events for one block's query. Results are cached for the page's
 *  lifetime; the composer is a short-lived editing session, and an admin who
 *  needs today's freshest list can reload. */
export function useLiveEvents(q: BlockQuery, timeZone: string) {
  const key = queryKey(q);
  const [events, setEvents] = useState<CalendarEventDTO[] | null>(null);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    void fetchEvents(q, timeZone).then((e) => {
      if (alive) setEvents(e);
    });
    return () => {
      alive = false;
    };
    // `key` already encodes every input that changes the query; depending on the
    // attrs object itself would re-fire on every render, since it's a fresh
    // reference each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, timeZone]);

  return events;
}
