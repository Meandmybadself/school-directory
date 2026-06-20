import { describe, it, expect } from "vitest";
import { haversineMiles, approxDistance, boundingBox } from "../src/lib/geo.js";
import { renderLastName, displayName } from "../src/lib/privacy.js";
import { ulid } from "../src/lib/ids.js";
import { buildGraph, ancestors, subtree, effectiveGroups, wouldCycle } from "../src/lib/groupTree.js";
import { parseIcs } from "../src/lib/calendar.js";

describe("geo", () => {
  it("computes great-circle distance in miles", () => {
    // ~0.3 mi between two nearby SF points
    const d = haversineMiles(37.7849, -122.4094, 37.7853, -122.414);
    expect(d).toBeGreaterThan(0.2);
    expect(d).toBeLessThan(0.5);
  });

  it("rounds distance to one decimal and never exposes raw coords", () => {
    expect(approxDistance(0.43)).toBe("~0.4 mi");
    expect(approxDistance(1.05)).toMatch(/^~\d+\.\d mi$/);
  });

  it("bounding box brackets the point", () => {
    const b = boundingBox(37.78, -122.41, 2);
    expect(b.minLat).toBeLessThan(37.78);
    expect(b.maxLat).toBeGreaterThan(37.78);
  });
});

describe("last-name rule", () => {
  it("controllers always see the full name (even when set to initial)", () => {
    expect(renderLastName("Ruiz", "initial", true)).toBe("Ruiz");
    expect(displayName("Dana", "Ruiz", "initial", true)).toBe("Dana Ruiz");
  });
  it("non-controllers get full or initial per policy (never fully hidden)", () => {
    expect(renderLastName("Ruiz", "full", false)).toBe("Ruiz");
    expect(renderLastName("Ruiz", "initial", false)).toBe("R.");
    expect(displayName("Dana", "Ruiz", "full", false)).toBe("Dana Ruiz");
    expect(displayName("Dana", "Ruiz", "initial", false)).toBe("Dana R.");
  });
});

describe("ulid", () => {
  it("is 26 chars and monotonic within the same millisecond", () => {
    const a = ulid(1000);
    const b = ulid(1000);
    expect(a).toHaveLength(26);
    expect(b > a).toBe(true);
  });
  it("sorts by time", () => {
    const early = ulid(1000);
    const late = ulid(2000);
    expect(late > early).toBe(true);
  });
});

describe("group hierarchy closure", () => {
  // School → {Grade4, Faculty}; Grade4 → {Room4A, Room4B}
  const edges = [
    { id: "school", parentId: null },
    { id: "grade4", parentId: "school" },
    { id: "faculty", parentId: "school" },
    { id: "room4a", parentId: "grade4" },
    { id: "room4b", parentId: "grade4" },
    { id: "house", parentId: null }, // household: never nests
  ];
  const { parentOf, childrenOf } = buildGraph(edges);

  it("ancestors run immediate-parent-first up to the root", () => {
    expect(ancestors(parentOf, "room4a")).toEqual(["grade4", "school"]);
    expect(ancestors(parentOf, "school")).toEqual([]);
  });

  it("subtree includes the node and all descendants", () => {
    expect(subtree(childrenOf, "grade4").sort()).toEqual(["grade4", "room4a", "room4b"]);
    expect(subtree(childrenOf, "room4a")).toEqual(["room4a"]);
  });

  it("effective groups roll a classroom member up into grade and school", () => {
    expect(effectiveGroups(parentOf, ["room4a"])).toEqual(new Set(["room4a", "grade4", "school"]));
    // A direct school member is NOT pushed down into grades/classrooms.
    expect(effectiveGroups(parentOf, ["school"])).toEqual(new Set(["school"]));
  });

  it("rejects reparenting that would create a cycle", () => {
    expect(wouldCycle(childrenOf, "grade4", "room4a")).toBe(true); // parent into own child
    expect(wouldCycle(childrenOf, "grade4", "grade4")).toBe(true); // self
    expect(wouldCycle(childrenOf, "faculty", "grade4")).toBe(false); // sibling move is fine
  });

  it("is cycle-safe even on malformed data", () => {
    const bad = buildGraph([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]);
    expect(() => ancestors(bad.parentOf, "a")).not.toThrow();
    expect(() => subtree(bad.childrenOf, "a")).not.toThrow();
  });
});

describe("ICS parsing", () => {
  const ICS = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    "BEGIN:VEVENT",
    "UID:timed-1",
    "SUMMARY:Timed Event",
    "DTSTART:20260615T150000Z",
    "DTEND:20260615T160000Z",
    "LOCATION:Gym",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:allday-1",
    "SUMMARY:All Day Event",
    "DTSTART;VALUE=DATE:20260616",
    "DTEND;VALUE=DATE:20260617",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:weekly-1",
    "SUMMARY:Weekly Meeting",
    "DTSTART:20260601T170000Z",
    "DTEND:20260601T173000Z",
    "RRULE:FREQ=WEEKLY;COUNT=10",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const events = parseIcs(ICS, new Date("2026-06-10T00:00:00Z"), new Date("2026-06-30T00:00:00Z"));

  it("includes timed and all-day events within the window", () => {
    const timed = events.find((e) => e.title === "Timed Event");
    expect(timed?.allDay).toBe(false);
    expect(timed?.location).toBe("Gym");
    expect(timed?.start).toBe("2026-06-15T15:00:00.000Z");

    const allday = events.find((e) => e.title === "All Day Event");
    expect(allday?.allDay).toBe(true);
  });

  it("expands a weekly recurrence, bounded to the window", () => {
    // FREQ=WEEKLY from 2026-06-01: occurrences on 6/15, 6/22, 6/29 fall in window.
    const weekly = events.filter((e) => e.title === "Weekly Meeting");
    expect(weekly.length).toBe(3);
  });

  it("ignores events outside the window", () => {
    // 6/1 and 6/8 weekly occurrences are before windowStart; nothing past 6/30.
    expect(events.every((e) => e.start >= "2026-06-10" && e.start <= "2026-06-30")).toBe(true);
  });
});
