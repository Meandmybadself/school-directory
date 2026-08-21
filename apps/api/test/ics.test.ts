// The ICS writer, and the round-trip that materializes managed occurrences.
// The round-trip is the load-bearing property: lib/managedCalendar.ts expands an
// authored event by rendering it here and parsing it back with parseIcs, so if
// these agree, a member's agenda and a subscriber's feed cannot disagree.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { icsDate, renderCalendar, rruleValue, weekdayOf, type IcsEventInput } from "../src/lib/icsWriter.js";
import { parseIcs, renderImportedSourceIcs } from "../src/lib/calendar.js";
import { ics as icsRouter } from "../src/routes/ics.js";
import type { Env } from "../src/env.js";
import type { HonoEnv } from "../src/env.js";

const base: IcsEventInput = {
  uid: "01J8ZK@eisenhower.school",
  title: "Assembly",
  location: null,
  description: null,
  start: "2026-06-15T15:00:00.000Z",
  end: "2026-06-15T16:00:00.000Z",
  allDay: false,
  recurrence: null,
  sequence: 0,
  updatedAt: "2026-06-01T12:00:00.000Z",
};

/** Expand a rendered event the same way lib/managedCalendar.ts does. */
function roundTrip(e: IcsEventInput, windowEnd = "2027-01-01T00:00:00.000Z") {
  const ics = renderCalendar("Test", [e]);
  return parseIcs(ics, new Date(e.start), new Date(windowEnd));
}

describe("ics date formatting", () => {
  it("renders timed values as UTC date-time and all-day as DATE", () => {
    expect(icsDate("2026-06-15T15:00:00.000Z", false)).toBe("20260615T150000Z");
    expect(icsDate("2026-06-15T00:00:00.000Z", true)).toBe("20260615");
  });

  it("reads weekdays in UTC", () => {
    expect(weekdayOf("2026-06-15T15:00:00.000Z")).toBe("MO");
    expect(weekdayOf("2026-06-20T15:00:00.000Z")).toBe("SA");
  });
});

describe("ics document structure", () => {
  it("wraps events in a VCALENDAR with CRLF endings and a trailing break", () => {
    const out = renderCalendar("School Events", [base]);
    expect(out.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(out).toContain("BEGIN:VEVENT\r\n");
    expect(out).toContain("SUMMARY:Assembly");
    expect(out).toContain("SEQUENCE:0");
    expect(out).toContain("DTSTAMP:20260601T120000Z");
  });

  it("escapes the TEXT delimiters and newlines", () => {
    const out = renderCalendar("Test", [
      { ...base, title: "Movie; popcorn, soda", description: "Line one\nLine two \\ done" },
    ]);
    expect(out).toContain("SUMMARY:Movie\\; popcorn\\, soda");
    expect(out).toContain("DESCRIPTION:Line one\\nLine two \\\\ done");
  });

  it("folds a long line at 75 octets and continues with a leading space", () => {
    const out = renderCalendar("Test", [{ ...base, title: "A".repeat(200) }]);
    const physical = out.split("\r\n").filter((l) => l.length > 0);
    for (const line of physical) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Continuations are marked by the single leading space.
    expect(out).toContain("\r\n A");
  });

  it("does not split a multi-byte character across a fold", () => {
    // Each emoji is 4 UTF-8 bytes; a naive slice at 75 would cut one in half.
    const out = renderCalendar("Test", [{ ...base, title: "🎓".repeat(40) }]);
    // Unfold and confirm the title survives intact.
    const unfolded = out.replace(/\r\n /g, "");
    expect(unfolded).toContain(`SUMMARY:${"🎓".repeat(40)}`);
  });

  it("marks all-day events with VALUE=DATE on both ends", () => {
    const out = renderCalendar("Test", [
      { ...base, allDay: true, start: "2026-06-15T00:00:00.000Z", end: "2026-06-17T00:00:00.000Z" },
    ]);
    expect(out).toContain("DTSTART;VALUE=DATE:20260615");
    expect(out).toContain("DTEND;VALUE=DATE:20260617");
  });

  it("omits DTEND when the event has no end", () => {
    expect(renderCalendar("Test", [{ ...base, end: null }])).not.toContain("DTEND");
  });
});

describe("rrule serialization", () => {
  const until = "2026-07-15T00:00:00.000Z";

  it("emits BYDAY for weekly rules, defaulting to the start's weekday", () => {
    expect(rruleValue({ freq: "weekly", until }, base.start, false)).toBe(
      "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260715T000000Z",
    );
    expect(rruleValue({ freq: "weekly", byDay: ["TU", "TH"], until }, base.start, false)).toBe(
      "FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260715T000000Z",
    );
  });

  it("anchors monthly rules to the start's day of month", () => {
    expect(rruleValue({ freq: "monthly", until }, base.start, false)).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20260715T000000Z",
    );
  });

  it("includes INTERVAL only when it is not 1", () => {
    expect(rruleValue({ freq: "daily", interval: 1, until }, base.start, false)).toBe(
      "FREQ=DAILY;UNTIL=20260715T000000Z",
    );
    expect(rruleValue({ freq: "daily", interval: 3, until }, base.start, false)).toBe(
      "FREQ=DAILY;INTERVAL=3;UNTIL=20260715T000000Z",
    );
  });

  it("matches UNTIL's value type to DTSTART's, per RFC 5545", () => {
    expect(rruleValue({ freq: "weekly", until }, base.start, true)).toContain("UNTIL=20260715");
    expect(rruleValue({ freq: "weekly", until }, base.start, true)).not.toContain("UNTIL=20260715T");
  });
});

describe("write → parse round trip (occurrence materialization)", () => {
  it("recovers a single timed event unchanged", () => {
    const out = roundTrip({ ...base, location: "Gym", description: "Bring water." }, "2026-06-16T00:00:00.000Z");
    expect(out.length).toBe(1);
    expect(out[0]).toMatchObject({
      title: "Assembly",
      location: "Gym",
      description: "Bring water.",
      start: "2026-06-15T15:00:00.000Z",
      end: "2026-06-15T16:00:00.000Z",
      allDay: false,
    });
  });

  it("recovers an all-day event as all-day", () => {
    const out = roundTrip(
      { ...base, allDay: true, start: "2026-06-15T00:00:00.000Z", end: "2026-06-16T00:00:00.000Z" },
      "2026-06-17T00:00:00.000Z",
    );
    expect(out.length).toBe(1);
    expect(out[0]!.allDay).toBe(true);
    expect(out[0]!.start).toBe("2026-06-15T00:00:00.000Z");
  });

  it("expands a weekly rule to one occurrence per week through UNTIL", () => {
    // Mondays 6/15 through 7/13 inclusive = 5 occurrences.
    const out = roundTrip({ ...base, recurrence: { freq: "weekly", until: "2026-07-13T15:00:00.000Z" } });
    expect(out.map((o) => o.start.slice(0, 10))).toEqual([
      "2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13",
    ]);
  });

  it("expands a weekly rule on several weekdays", () => {
    // Start Mon 6/15, repeat Tue+Thu until 6/26: 6/16, 6/18, 6/23, 6/25.
    // The 6/15 DTSTART itself is not on a listed day, so it is not an occurrence.
    const out = roundTrip({
      ...base,
      recurrence: { freq: "weekly", byDay: ["TU", "TH"], until: "2026-06-26T15:00:00.000Z" },
    });
    expect(out.map((o) => o.start.slice(0, 10))).toEqual([
      "2026-06-16", "2026-06-18", "2026-06-23", "2026-06-25",
    ]);
  });

  it("honours INTERVAL", () => {
    const out = roundTrip({
      ...base,
      recurrence: { freq: "daily", interval: 5, until: "2026-06-30T15:00:00.000Z" },
    });
    expect(out.map((o) => o.start.slice(0, 10))).toEqual([
      "2026-06-15", "2026-06-20", "2026-06-25", "2026-06-30",
    ]);
  });

  it("expands a monthly rule on the start's day of month", () => {
    const out = roundTrip({
      ...base,
      recurrence: { freq: "monthly", until: "2026-09-15T15:00:00.000Z" },
    });
    expect(out.map((o) => o.start.slice(0, 10))).toEqual([
      "2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15",
    ]);
  });

  it("stops at UNTIL, inclusive of an occurrence landing exactly on it", () => {
    const out = roundTrip({ ...base, recurrence: { freq: "weekly", until: "2026-06-22T15:00:00.000Z" } });
    expect(out.length).toBe(2);
    expect(out[1]!.start).toBe("2026-06-22T15:00:00.000Z");
  });

  it("carries each occurrence's end, preserving the authored duration", () => {
    const out = roundTrip({ ...base, recurrence: { freq: "weekly", until: "2026-06-22T15:00:00.000Z" } });
    expect(out[1]!.end).toBe("2026-06-22T16:00:00.000Z");
  });

  it("expands an all-day recurring event with a DATE-typed UNTIL", () => {
    const out = roundTrip({
      ...base,
      allDay: true,
      start: "2026-06-15T00:00:00.000Z",
      end: "2026-06-16T00:00:00.000Z",
      recurrence: { freq: "weekly", until: "2026-06-29T00:00:00.000Z" },
    });
    // Full timestamps, not just the date part: an all-day occurrence must land on
    // midnight UTC regardless of the host timezone. Comparing only the date would
    // hide a host-offset shift until it crossed a day boundary.
    expect(out.map((o) => o.start)).toEqual([
      "2026-06-15T00:00:00.000Z",
      "2026-06-22T00:00:00.000Z",
      "2026-06-29T00:00:00.000Z",
    ]);
    expect(out.every((o) => o.allDay)).toBe(true);
  });
});

// ── The imported-calendar mirror ────────────────────────────────────────────
//
// /ics/source/:id.ics re-serves what we stored rather than proxying the upstream
// feed, which is what lets the public agenda offer a download for EVERY calendar
// without publishing an admin's pasted subscribe link. The UID rules below are
// the load-bearing part: the rows are pre-expanded occurrences, so a naive
// mirror would either collapse a series into one event or make every event look
// new after each refresh.

/** Minimal D1 stand-in: renderImportedSourceIcs makes exactly two queries,
 *  distinguished by `.first()` (the source) vs `.all()` (its events). */
function mirrorEnv(source: unknown | null, events: unknown[]): Env {
  return {
    DB: {
      prepare() {
        return {
          bind: () => ({
            first: async () => source,
            all: async () => ({ results: events }),
          }),
        };
      },
    },
  } as unknown as Env;
}

const source = { id: "01SRC", name: "Hopkins District", last_fetched_at: "2026-06-01T12:00:00.000Z" };

function row(over: Record<string, unknown> = {}) {
  return {
    uid: "abc123@google.com",
    title: "Early release",
    location: "Eisenhower Elementary",
    description: "Buses run two hours early.",
    starts_at: "2026-06-15T15:00:00.000Z",
    ends_at: "2026-06-15T16:00:00.000Z",
    all_day: 0,
    ...over,
  };
}

describe("imported calendar mirror", () => {
  it("renders the stored events under the calendar's name", async () => {
    const out = (await renderImportedSourceIcs(mirrorEnv(source, [row()]), "01SRC"))!;
    expect(out).toContain("X-WR-CALNAME:Hopkins District");
    expect(out).toContain("SUMMARY:Early release");
    expect(out).toContain("LOCATION:Eisenhower Elementary");
    expect(out).toContain("DTSTART:20260615T150000Z");
    expect(out).toContain("DTEND:20260615T160000Z");
    // The refresh time is the only "modified" signal a mirror has.
    expect(out).toContain("DTSTAMP:20260601T120000Z");
  });

  it("gives each occurrence of one upstream series a distinct UID", async () => {
    // All three rows share the upstream UID; emitted verbatim, a subscriber
    // would collapse the series into a single event.
    const rows = ["2026-06-15T15:00:00.000Z", "2026-06-22T15:00:00.000Z", "2026-06-29T15:00:00.000Z"].map((s) =>
      row({ starts_at: s, ends_at: null }),
    );
    const out = (await renderImportedSourceIcs(mirrorEnv(source, rows), "01SRC"))!;
    const uids = [...out.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]);
    expect(uids).toEqual([
      "abc123-20260615T150000Z@eisenhower.school",
      "abc123-20260622T150000Z@eisenhower.school",
      "abc123-20260629T150000Z@eisenhower.school",
    ]);
  });

  it("derives UIDs only from data that survives a refresh", async () => {
    // calendar_event.id is re-minted on every refresh (invariant 8). Two renders
    // of the same upstream event must agree, or a subscriber sees every event as
    // new each time the feed is pulled.
    const a = (await renderImportedSourceIcs(mirrorEnv(source, [row({ id: "01AAA" })]), "01SRC"))!;
    const b = (await renderImportedSourceIcs(mirrorEnv(source, [row({ id: "01BBB" })]), "01SRC"))!;
    expect(a.match(/^UID:.+$/m)![0]).toBe(b.match(/^UID:.+$/m)![0]);
  });

  it("falls back to a title-derived UID when upstream sent none", async () => {
    const out = (await renderImportedSourceIcs(mirrorEnv(source, [row({ uid: null })]), "01SRC"))!;
    expect(out).toContain("UID:01SRC-early-release-20260615T150000Z@eisenhower.school");
  });

  it("keeps all-day events all-day", async () => {
    const out = (await renderImportedSourceIcs(
      mirrorEnv(source, [row({ all_day: 1, starts_at: "2026-06-15T00:00:00.000Z", ends_at: null })]),
      "01SRC",
    ))!;
    expect(out).toContain("DTSTART;VALUE=DATE:20260615");
    expect(out).toContain("UID:abc123-20260615@eisenhower.school");
  });

  it("round-trips back to the occurrences it was built from", async () => {
    const out = (await renderImportedSourceIcs(mirrorEnv(source, [row()]), "01SRC"))!;
    const parsed = parseIcs(out, new Date("2026-06-01T00:00:00.000Z"), new Date("2026-07-01T00:00:00.000Z"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      title: "Early release",
      location: "Eisenhower Elementary",
      start: "2026-06-15T15:00:00.000Z",
      end: "2026-06-15T16:00:00.000Z",
      allDay: false,
    });
  });

  it("is null for a source that is unknown or disabled", async () => {
    // The SELECT filters on enabled = 1, so a disabled calendar reads as absent
    // — the published surface stays equal to what the filter chips list.
    expect(await renderImportedSourceIcs(mirrorEnv(null, []), "01SRC")).toBeNull();
  });
});

// ── One event as a download ──────────────────────────────────────────────────
//
// "Add to my calendar" on an event's own page (/e/:date/:slug) — a COPY of one
// occurrence, not a subscription. It is addressed by that page's content
// identity rather than by an id, for the reasons in packages/shared/src/
// eventPath.ts; test/eventPage.test.ts covers the lookup itself, so what matters
// here is the document it produces.
describe("GET /ics/event/:date/:file", () => {
  /** D1 stand-in for queryUpcomingEvents's single SELECT. */
  function eventEnv(): HonoEnv["Bindings"] {
    const eventRow = {
      id: "01EVENT",
      title: "Fall Carnival",
      location: "Gym",
      description: "Doors at 4.",
      starts_at: "2026-10-18T00:00:00.000Z", // 7pm Oct 17, Chicago
      ends_at: "2026-10-18T03:00:00.000Z",
      all_day: 0,
      managed_event_id: "01SERIES",
      source_id: "01MC",
      source_name: "PTO events",
      source_color: "#0068A8",
      volunteer_slug: null,
    };
    return {
      DB: {
        prepare() {
          // Honours the query's own window binds ([from, from, to, cap]), so a
          // link pointing at the wrong week genuinely finds nothing here.
          return {
            bind: (from: string, _from2: string, to: string) => ({
              all: async () => ({
                results: eventRow.starts_at >= from && eventRow.starts_at < to ? [eventRow] : [],
              }),
            }),
          };
        },
      },
    } as unknown as HonoEnv["Bindings"];
  }

  const app = new Hono<HonoEnv>().route("/ics", icsRouter);

  it("serves one VEVENT as text/calendar", async () => {
    const res = await app.request("/ics/event/2026-10-17/fall-carnival.ics", {}, eventEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");

    const body = await res.text();
    expect(body).toContain("SUMMARY:Fall Carnival");
    expect(body).toContain("LOCATION:Gym");
    expect(body).toContain("DTSTART:20261018T000000Z");
    // One occurrence, flattened: a reader adding "this Saturday" must not get
    // the whole series.
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(body).not.toContain("RRULE");
  });

  it("uses a UID derived from the content identity, not the row id", async () => {
    // calendar_event.id is re-minted on every refresh (invariant 8); keying the
    // UID on it would make each download look like a brand new event and
    // duplicate it in the reader's calendar.
    const body = await (await app.request("/ics/event/2026-10-17/fall-carnival.ics", {}, eventEnv())).text();
    expect(body).toContain("UID:fall-carnival-20261018T000000Z@eisenhower.school");
    expect(body).not.toContain("01EVENT");
  });

  it("publishes nothing the public event page withholds", async () => {
    // The download is as anonymous as the page it hangs off, so the durable
    // handle volunteer signups key on must not appear in it either.
    const body = await (await app.request("/ics/event/2026-10-17/fall-carnival.ics", {}, eventEnv())).text();
    expect(body).not.toContain("01SERIES");
  });

  it("404s without the .ics suffix, and for an event that isn't there", async () => {
    expect((await app.request("/ics/event/2026-10-17/fall-carnival", {}, eventEnv())).status).toBe(404);
    expect((await app.request("/ics/event/2026-11-24/fall-carnival.ics", {}, eventEnv())).status).toBe(404);
  });
});
