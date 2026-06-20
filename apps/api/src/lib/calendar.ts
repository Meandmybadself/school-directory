// Shared calendar: fetch public ICS feeds, expand recurrences, and store the
// upcoming window in D1. Reads serve from D1; this runs on a cron schedule
// (and on-demand via the admin "refresh" action). ical.js is pure JS and runs
// under nodejs_compat — we fetch the ICS text ourselves (per the geocode.ts
// pattern) and hand the string to the parser.

import ICAL from "ical.js";
import type { CalendarEventDTO } from "@sd/shared";
import type { Env } from "../env.js";
import { ulid } from "./ids.js";
import { nowIso } from "./time.js";

/** How far back/forward to materialize events on each refresh. */
const PAST_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // keep 2 days of just-past events
const FUTURE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000; // 180 days ahead
/** Hard cap on iterations when expanding one recurring VEVENT. Bounds the
 *  catch-up cost for a rule that started far in the past (it counts every step,
 *  not just in-window ones) while still reaching the window for ~13y of dailies
 *  / ~96y of weeklies. */
const MAX_ITERATIONS = 5000;
/** Cap on stored events per source, to bound a pathological feed. */
const MAX_EVENTS_PER_SOURCE = 2000;
/** Insert chunk size — D1 batches are kept modest rather than one huge batch. */
const INSERT_CHUNK = 100;
/** Abort a feed fetch that hangs, so one bad source can't stall the refresh. */
const FETCH_TIMEOUT_MS = 15000;

interface ParsedEvent {
  uid: string | null;
  title: string;
  location: string | null;
  description: string | null;
  start: string; // ISO-8601 UTC
  end: string | null; // ISO-8601 UTC
  allDay: boolean;
}

function userAgent(env: Env): string {
  return `${env.SCHOOL_NAME ?? "School"} School Directory (+https://github.com/Meandmybadself/school-directory)`;
}

/** A school-feed event with no SUMMARY still gets a usable title. */
function titleOf(event: ICAL.Event): string {
  return (event.summary ?? "").trim() || "(untitled)";
}

/** Parse ICS text into a flat list of events, expanding recurrences within
 *  [windowStart, windowEnd]. Times are normalized to UTC ISO strings. */
export function parseIcs(text: string, windowStart: Date, windowEnd: Date): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  const comp = new ICAL.Component(ICAL.parse(text));
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();

  for (const ve of comp.getAllSubcomponents("vevent")) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(ve);
    } catch {
      continue; // skip malformed components rather than fail the whole feed
    }
    if (!event.startDate) continue;

    const push = (start: ICAL.Time, end: ICAL.Time | null) => {
      const startDate = start.toJSDate();
      out.push({
        uid: event.uid ?? null,
        title: titleOf(event),
        location: (event.location ?? "").trim() || null,
        description: (event.description ?? "").trim() || null,
        start: startDate.toISOString(),
        end: end ? end.toJSDate().toISOString() : null,
        allDay: start.isDate === true,
      });
    };

    if (event.isRecurring()) {
      const iter = event.iterator();
      let next: ICAL.Time | null;
      let iterations = 0;
      // Count every iteration (incl. pre-window catch-up) toward the cap, so a
      // long-past rule can't loop forever, but only STORE in-window occurrences.
      while ((next = iter.next()) && iterations < MAX_ITERATIONS) {
        iterations++;
        const occMs = next.toJSDate().getTime();
        if (occMs > endMs) break;
        if (occMs < startMs) continue; // already past the window's start
        try {
          const det = event.getOccurrenceDetails(next);
          push(det.startDate, det.endDate ?? null);
        } catch {
          // ignore a single bad occurrence
        }
      }
    } else {
      const occMs = event.startDate.toJSDate().getTime();
      if (occMs >= startMs && occMs < endMs) push(event.startDate, event.endDate ?? null);
    }
  }
  return out;
}

interface SourceRow {
  id: string;
  url: string;
}

/** Fetch one feed, parse it, and replace this source's stored events. Records
 *  status/error on the source. Never throws — failures are recorded. */
export async function refreshSource(env: Env, source: SourceRow): Promise<{ ok: boolean; count: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - PAST_WINDOW_MS);
  const windowEnd = new Date(now.getTime() + FUTURE_WINDOW_MS);
  try {
    const res = await fetch(source.url, {
      headers: { "User-Agent": userAgent(env), Accept: "text/calendar, text/plain, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseIcs(text, windowStart, windowEnd);
    // Keep the earliest N upcoming events; bounds storage for pathological feeds.
    parsed.sort((a, b) => a.start.localeCompare(b.start));
    const events = parsed.slice(0, MAX_EVENTS_PER_SOURCE);

    // Replace-in-place: clear this source's events, then insert the fresh set in
    // modest chunks (rather than one huge D1 batch), then mark the source ok.
    const inserts = events.map((e) =>
      env.DB.prepare(
        `INSERT INTO calendar_event (id, source_id, uid, title, location, description, starts_at, ends_at, all_day, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(ulid(), source.id, e.uid, e.title, e.location, e.description, e.start, e.end, e.allDay ? 1 : 0, nowIso()),
    );
    await env.DB.prepare("DELETE FROM calendar_event WHERE source_id = ?").bind(source.id).run();
    for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
      await env.DB.batch(inserts.slice(i, i + INSERT_CHUNK));
    }
    await env.DB.prepare("UPDATE calendar_source SET last_fetched_at = ?, last_status = 'ok', last_error = NULL WHERE id = ?")
      .bind(nowIso(), source.id)
      .run();
    return { ok: true, count: events.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendar] refresh failed", source.id, msg);
    await env.DB.prepare("UPDATE calendar_source SET last_fetched_at = ?, last_status = 'error', last_error = ? WHERE id = ?")
      .bind(nowIso(), msg.slice(0, 300), source.id)
      .run()
      .catch(() => {});
    return { ok: false, count: 0 };
  }
}

/** A joined calendar_event row (event + its source) as read for serialization. */
export interface CalendarRow {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  source_id: string;
  source_name: string;
  source_color: string;
}

/** Collapse the same event syndicated across multiple feeds into one. Events are
 *  matched on title + day + time-to-the-minute (tolerating sub-minute timestamp
 *  differences between feeds); the merged event keeps the richest copy (longest
 *  description, any location) and records every source it appears on, so the
 *  per-calendar filter can hide it only when all its sources are hidden.
 *  `rows` must be ordered by start; output preserves that order, capped to `limit`. */
export function dedupeEvents(rows: CalendarRow[], limit: number): CalendarEventDTO[] {
  interface Merged {
    dto: CalendarEventDTO;
    descLen: number;
  }
  const byKey = new Map<string, Merged>();
  const order: string[] = [];
  for (const r of rows) {
    // Match on title + day + time to the minute (e.g. "2026-06-15T15:00").
    const key = `${r.title.trim().toLowerCase()}|${r.starts_at.slice(0, 16)}`;
    let m = byKey.get(key);
    if (!m) {
      m = {
        dto: {
          id: r.id,
          title: r.title,
          location: r.location,
          description: r.description,
          start: r.starts_at,
          end: r.ends_at,
          allDay: r.all_day === 1,
          sourceIds: [r.source_id],
          source: { name: r.source_name, color: r.source_color },
        },
        descLen: (r.description ?? "").length,
      };
      byKey.set(key, m);
      order.push(key);
      continue;
    }
    if (!m.dto.sourceIds.includes(r.source_id)) m.dto.sourceIds.push(r.source_id);
    if (!m.dto.location && r.location) m.dto.location = r.location;
    const dlen = (r.description ?? "").length;
    if (dlen > m.descLen) {
      m.dto.description = r.description;
      m.descLen = dlen;
    }
  }
  return order.slice(0, limit).map((k) => byKey.get(k)!.dto);
}

/** Refresh every enabled source. Used by the cron handler and the admin button. */
export async function refreshAllSources(env: Env): Promise<{ sources: number; events: number }> {
  const rows = await env.DB.prepare("SELECT id, url FROM calendar_source WHERE enabled = 1").all<SourceRow>();
  let events = 0;
  // Sequentially, to stay gentle on the feed hosts (single school, few feeds).
  for (const s of rows.results) {
    const r = await refreshSource(env, s);
    events += r.count;
  }
  return { sources: rows.results.length, events };
}
