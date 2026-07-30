// Calendar list + live event lookup for events blocks.
//
// Every events block needs the same list of pickable calendars, and several
// blocks often ask for overlapping event windows. Fetching per block would mean
// one request per keystroke on the lookahead input, so both are cached at module
// scope: the feed list once, and event queries by their (calendars, window) key.

import { useEffect, useState } from "react";
import type { CalendarEventDTO, CalendarFeedDTO, NewsletterNode } from "@sd/shared";
import { collectEventsBlocks } from "@sd/shared";
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

const DAY_MS = 24 * 60 * 60 * 1000;
const eventCache = new Map<string, Promise<CalendarEventDTO[]>>();

function queryKey(calendarIds: string[], lookaheadDays: number): string {
  return `${[...calendarIds].sort().join(",")}|${lookaheadDays}`;
}

function fetchEvents(calendarIds: string[], lookaheadDays: number): Promise<CalendarEventDTO[]> {
  const key = queryKey(calendarIds, lookaheadDays);
  let promise = eventCache.get(key);
  if (!promise) {
    const from = new Date();
    promise = api
      .calendarEvents({
        from: from.toISOString(),
        to: new Date(from.getTime() + lookaheadDays * DAY_MS).toISOString(),
        calendars: calendarIds,
        limit: 50,
      })
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
): Record<string, CalendarEventDTO[]> {
  const [resolved, setResolved] = useState<Record<string, CalendarEventDTO[]>>({});
  const blocks = frozen ? [] : collectEventsBlocks(doc);
  // Re-resolve only when a block's query actually changes, not on every keystroke.
  const signature = blocks.map((b) => `${b.blockId}:${queryKey(b.calendarIds, b.lookaheadDays)}`).join(";");

  useEffect(() => {
    if (frozen) return;
    let alive = true;
    void Promise.all(
      blocks.map(async (b) => [b.blockId, await fetchEvents(b.calendarIds, b.lookaheadDays)] as const),
    ).then((entries) => {
      if (alive) setResolved(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, frozen]);

  return frozen ?? resolved;
}

/** Live events for one block's query. Results are cached for the page's
 *  lifetime; the composer is a short-lived editing session, and an admin who
 *  needs today's freshest list can reload. */
export function useLiveEvents(calendarIds: string[], lookaheadDays: number) {
  const key = queryKey(calendarIds, lookaheadDays);
  const [events, setEvents] = useState<CalendarEventDTO[] | null>(null);

  useEffect(() => {
    let alive = true;
    setEvents(null);
    void fetchEvents(calendarIds, lookaheadDays).then((e) => {
      if (alive) setEvents(e);
    });
    return () => {
      alive = false;
    };
    // `key` already encodes both inputs; depending on the array itself would
    // re-fire on every render, since it's a fresh reference each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return events;
}
