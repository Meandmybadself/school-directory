// The ICS writer, and the round-trip that materializes managed occurrences.
// The round-trip is the load-bearing property: lib/managedCalendar.ts expands an
// authored event by rendering it here and parsing it back with parseIcs, so if
// these agree, a member's agenda and a subscriber's feed cannot disagree.

import { describe, expect, it } from "vitest";
import { icsDate, renderCalendar, rruleValue, weekdayOf, type IcsEventInput } from "../src/lib/icsWriter.js";
import { parseIcs } from "../src/lib/calendar.js";

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
