// Event selection for a newsletter block: which events its window asks for, and
// which of them the author kept.
//
// These run on the same code the composer's preview, the /events endpoint and
// the send-time freeze all call. A disagreement between any two of them is the
// bug class this file exists to catch.

import { describe, expect, it } from "vitest";
import type { CalendarEventDTO } from "@sd/shared";
import {
  blockWindow,
  eventKey,
  hasFixedRange,
  shiftIsoDate,
  visibleEvents,
  zonedDayStartUtc,
} from "@sd/shared";

const CHICAGO = "America/Chicago";

function ev(over: Partial<CalendarEventDTO> = {}): CalendarEventDTO {
  return {
    id: "cev_01",
    kind: "imported",
    title: "Chess Club",
    location: null,
    description: null,
    start: "2026-08-04T17:00:00.000Z",
    end: null,
    allDay: false,
    sourceIds: ["src_1"],
    source: { name: "PTA", color: "#0068A8" },
    volunteerSlug: null,
    ...over,
  };
}

describe("eventKey", () => {
  it("addresses a managed occurrence by its durable pair, not its row id", () => {
    const a = ev({ id: "cev_aaa", kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-04T17:00:00.000Z" });
    // Same occurrence after the cache was rebuilt: fresh ULID, same series.
    const b = ev({ id: "cev_zzz", kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-04T17:00:00.000Z" });
    expect(eventKey(a)).toBe(eventKey(b));
  });

  it("keeps a managed exclusion attached across a retitle", () => {
    const before = ev({ kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-04T17:00:00.000Z" });
    const after = ev({ kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-04T17:00:00.000Z", title: "Chess Club (moved)" });
    expect(eventKey(after)).toBe(eventKey(before));
  });

  it("separates occurrences of one series", () => {
    const week1 = ev({ kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-04T17:00:00.000Z" });
    const week2 = ev({ kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-11T17:00:00.000Z" });
    expect(eventKey(week1)).not.toBe(eventKey(week2));
  });

  it("falls back to content identity for an imported event, which has no durable id", () => {
    const a = ev({ id: "cev_aaa" });
    const b = ev({ id: "cev_bbb" });
    expect(eventKey(a)).toBe(eventKey(b));
    expect(eventKey(a)).not.toContain("cev_");
  });

  it("ignores case and padding in an imported title, as dedupeEvents does", () => {
    expect(eventKey(ev({ title: "  Chess CLUB " }))).toBe(eventKey(ev({ title: "chess club" })));
  });

  it("does not confuse a managed event with an imported one of the same name", () => {
    const managed = ev({ kind: "managed", seriesId: "me_1", recurrenceId: "2026-08-04T17:00:00.000Z" });
    expect(eventKey(managed)).not.toBe(eventKey(ev()));
  });
});

describe("visibleEvents", () => {
  const list = [
    ev({ id: "a", title: "Chess Club", start: "2026-08-04T17:00:00.000Z" }),
    ev({ id: "b", title: "Book Fair", start: "2026-08-10T14:00:00.000Z" }),
  ];

  it("returns everything when nothing was removed", () => {
    expect(visibleEvents({ excluded: [] }, list)).toHaveLength(2);
  });

  it("drops exactly the removed event", () => {
    const out = visibleEvents({ excluded: [eventKey(list[1]!)] }, list);
    expect(out.map((e) => e.title)).toEqual(["Chess Club"]);
  });

  it("ignores a stale key that no longer matches anything", () => {
    expect(visibleEvents({ excluded: ["i:gone|2020-01-01T00:00"] }, list)).toHaveLength(2);
  });
});

describe("zonedDayStartUtc", () => {
  it("reads a date as midnight where the school is, not midnight UTC", () => {
    // Chicago is UTC-5 in August, so Aug 1 begins at 05:00Z.
    expect(zonedDayStartUtc("2026-08-01", CHICAGO)).toBe("2026-08-01T05:00:00.000Z");
  });

  it("uses the winter offset in winter", () => {
    // UTC-6 once DST ends.
    expect(zonedDayStartUtc("2026-01-15", CHICAGO)).toBe("2026-01-15T06:00:00.000Z");
  });

  it("resolves the spring-forward day correctly", () => {
    // DST starts 2026-03-08; the day still begins at the pre-transition offset.
    expect(zonedDayStartUtc("2026-03-08", CHICAGO)).toBe("2026-03-08T06:00:00.000Z");
    expect(zonedDayStartUtc("2026-03-09", CHICAGO)).toBe("2026-03-09T05:00:00.000Z");
  });

  it("agrees with UTC when the zone is UTC", () => {
    expect(zonedDayStartUtc("2026-08-01", "UTC")).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("shiftIsoDate", () => {
  it("crosses a month boundary", () => {
    expect(shiftIsoDate("2026-08-31", 1)).toBe("2026-09-01");
  });
  it("crosses a leap day", () => {
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("goes backwards", () => {
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("blockWindow", () => {
  const now = "2026-08-04T12:00:00.000Z";

  it("rolls forward from now when there is no fixed range", () => {
    const w = blockWindow({ lookaheadDays: 14, rangeStart: null, rangeEnd: null }, now, CHICAGO);
    expect(w.from).toBe(now);
    expect(w.to).toBe("2026-08-18T12:00:00.000Z");
  });

  it("uses the author's dates when both are set", () => {
    const w = blockWindow(
      { lookaheadDays: 14, rangeStart: "2026-08-01", rangeEnd: "2026-08-14" },
      now,
      CHICAGO,
    );
    expect(w.from).toBe("2026-08-01T05:00:00.000Z");
    // Exclusive end: the start of the day AFTER rangeEnd, so Aug 14 is included.
    expect(w.to).toBe("2026-08-15T05:00:00.000Z");
  });

  it("includes an event late on the final day", () => {
    const w = blockWindow(
      { lookaheadDays: 14, rangeStart: "2026-08-01", rangeEnd: "2026-08-14" },
      now,
      CHICAGO,
    );
    const lateOnTheLastDay = "2026-08-15T02:00:00.000Z"; // 9pm Aug 14 in Chicago
    expect(lateOnTheLastDay < w.to).toBe(true);
  });

  it("excludes the first moment of the day after the range", () => {
    const w = blockWindow(
      { lookaheadDays: 14, rangeStart: "2026-08-01", rangeEnd: "2026-08-14" },
      now,
      CHICAGO,
    );
    expect("2026-08-15T05:00:00.000Z" < w.to).toBe(false);
  });

  it("treats a half-filled range as still rolling", () => {
    const onlyStart = blockWindow({ lookaheadDays: 7, rangeStart: "2026-08-01", rangeEnd: null }, now, CHICAGO);
    expect(onlyStart.from).toBe(now);
    const onlyEnd = blockWindow({ lookaheadDays: 7, rangeStart: null, rangeEnd: "2026-08-14" }, now, CHICAGO);
    expect(onlyEnd.from).toBe(now);
  });

  it("handles a single-day range", () => {
    const w = blockWindow(
      { lookaheadDays: 14, rangeStart: "2026-08-04", rangeEnd: "2026-08-04" },
      now,
      CHICAGO,
    );
    expect(w.from).toBe("2026-08-04T05:00:00.000Z");
    expect(w.to).toBe("2026-08-05T05:00:00.000Z");
  });
});

describe("hasFixedRange", () => {
  it("requires both ends", () => {
    expect(hasFixedRange({ rangeStart: "2026-08-01", rangeEnd: "2026-08-14" })).toBe(true);
    expect(hasFixedRange({ rangeStart: "2026-08-01", rangeEnd: null })).toBe(false);
    expect(hasFixedRange({ rangeStart: null, rangeEnd: "2026-08-14" })).toBe(false);
    expect(hasFixedRange({ rangeStart: null, rangeEnd: null })).toBe(false);
  });
});
