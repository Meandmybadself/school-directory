import { describe, it, expect } from "vitest";
import { haversineMiles, approxDistance, boundingBox } from "../src/lib/geo.js";
import { renderLastName, displayName, canSeeItem, type ContactItemRow } from "../src/lib/privacy.js";
import { ulid } from "../src/lib/ids.js";
import { buildGraph, ancestors, subtree, effectiveGroups, wouldCycle } from "../src/lib/groupTree.js";
import { parseIcs, dedupeEvents, type CalendarRow } from "../src/lib/calendar.js";
import { htmlToText, volunteerSheetSlug } from "@sd/shared";

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

describe("member's-eye preview (?as=member)", () => {
  const viewer = { userId: "u_dana", personId: "p_dana" };
  const item = (visibility: "service" | "private"): ContactItemRow => ({
    id: "ci_1",
    owner_kind: "person",
    owner_id: "p_dana",
    type: "phone",
    label: null,
    value: "555-0100",
    visibility,
    neighbor_discoverable: 0,
    geo_lat: null,
    geo_lng: null,
  });
  // Preview mode calls canSeeItem with the controller set and every share set
  // emptied — the exact inputs a plain member would resolve against.
  const asMember = (visibility: "service" | "private") =>
    canSeeItem({
      viewer,
      item: item(visibility),
      ownerControllerUserIds: new Set(),
      sharedWithPersonIds: new Set(),
      sharedWithGroupIds: new Set(),
      viewerGroups: new Set(),
    });

  it("hides a controller's own private item", () => {
    // Without the preview inputs the controller sees it; with them, they don't.
    expect(
      canSeeItem({
        viewer,
        item: item("private"),
        ownerControllerUserIds: new Set(["u_dana"]),
        sharedWithPersonIds: new Set(),
        sharedWithGroupIds: new Set(),
        viewerGroups: new Set(),
      }),
    ).toBe(true);
    expect(asMember("private")).toBe(false);
  });

  it("keeps member-visible items", () => {
    expect(asMember("service")).toBe(true);
  });

  it("hides a private item shared only with the previewer's own groups", () => {
    // A generic member is not a share target, so group shares must not leak in.
    expect(
      canSeeItem({
        viewer,
        item: item("private"),
        ownerControllerUserIds: new Set(),
        sharedWithPersonIds: new Set(),
        sharedWithGroupIds: new Set(["g_room5"]),
        viewerGroups: new Set(),
      }),
    ).toBe(false);
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
    { id: "house", parentId: "grade4" }, // a household may sit under a group
  ];
  const { parentOf, childrenOf } = buildGraph(edges);

  it("ancestors run immediate-parent-first up to the root", () => {
    expect(ancestors(parentOf, "room4a")).toEqual(["grade4", "school"]);
    expect(ancestors(parentOf, "school")).toEqual([]);
  });

  it("subtree includes the node and all descendants", () => {
    expect(subtree(childrenOf, "grade4").sort()).toEqual(["grade4", "house", "room4a", "room4b"]);
    expect(subtree(childrenOf, "room4a")).toEqual(["room4a"]);
  });

  // A household nested under a group joins that group's scope: its members roll
  // up and see what's shared there. The reverse must never happen — nothing may
  // sit under a household, or outsiders would roll up into the family's scope.
  // (The kind check itself lives in PATCH /groups/:id/parent; this pins the
  // closure behaviour the rule depends on.)
  it("rolls a nested household's members up into its parent group", () => {
    expect(effectiveGroups(parentOf, ["house"])).toEqual(new Set(["house", "grade4", "school"]));
    // …and never the other way: a grade member is not pulled into the household.
    expect(effectiveGroups(parentOf, ["grade4"]).has("house")).toBe(false);
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
    "DESCRIPTION:Bring water bottles.",
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
    expect(timed?.description).toBe("Bring water bottles.");
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

describe("calendar de-duplication", () => {
  const row = (over: Partial<CalendarRow>): CalendarRow => ({
    id: "e1", title: "Assembly", location: null, description: null,
    starts_at: "2026-06-15T15:00:00.000Z", ends_at: null, all_day: 0,
    source_id: "s1", source_name: "A", source_color: "#111111",
    managed_event_id: null, volunteer_slug: null, ...over,
  });

  it("merges the same event across feeds into one, collecting all sources", () => {
    const rows = [
      row({ id: "a", source_id: "s1", source_name: "A" }),
      row({ id: "b", source_id: "s2", source_name: "B", description: "Gym, 3pm" }),
      row({ id: "c", source_id: "s3", source_name: "C", location: "Gym" }),
      row({ id: "d", title: "Field Trip", starts_at: "2026-06-16T09:00:00.000Z", source_id: "s1" }),
    ];
    const out = dedupeEvents(rows, 100);
    expect(out.length).toBe(2);
    const assembly = out.find((e) => e.title === "Assembly")!;
    expect(assembly.sourceIds.sort()).toEqual(["s1", "s2", "s3"]);
    // Richest copy wins: description from feed B, location from feed C.
    expect(assembly.description).toBe("Gym, 3pm");
    expect(assembly.location).toBe("Gym");
  });

  it("treats different title/start as distinct and respects the limit", () => {
    const rows = [
      row({ id: "a", starts_at: "2026-06-15T15:00:00.000Z" }),
      row({ id: "b", title: "Other", starts_at: "2026-06-15T16:00:00.000Z" }),
      row({ id: "c", title: "Third", starts_at: "2026-06-15T17:00:00.000Z" }),
    ];
    expect(dedupeEvents(rows, 2).length).toBe(2);
  });

  it("matches on day + time to the minute (tolerates sub-minute differences)", () => {
    const rows = [
      row({ id: "a", source_id: "s1", starts_at: "2026-06-15T15:00:00.000Z" }),
      row({ id: "b", source_id: "s2", starts_at: "2026-06-15T15:00:42.000Z" }),
    ];
    const out = dedupeEvents(rows, 100);
    expect(out.length).toBe(1);
    expect(out[0]!.sourceIds.sort()).toEqual(["s1", "s2"]);
  });
});

describe("volunteerSheetSlug", () => {
  it("reads as the event followed by its date", () => {
    // Title-first, unlike an issue slug: this link is pasted into a message
    // asking people to sign up, where the event name is what identifies it.
    expect(volunteerSheetSlug("Fall Carnival", "2026-10-17T22:00:00.000Z")).toBe(
      "fall-carnival-2026-10-17",
    );
  });

  it("distinguishes two occurrences of the same recurring event", () => {
    // The reason a sheet is per-date: a weekly event's sheets must not collide
    // into one URL.
    const a = volunteerSheetSlug("Lunch Duty", "2026-10-05T17:00:00.000Z");
    const b = volunteerSheetSlug("Lunch Duty", "2026-10-12T17:00:00.000Z");
    expect(a).not.toBe(b);
  });

  it("takes the date in UTC, matching how occurrences are stored", () => {
    // Occurrence starts are ISO-8601 UTC everywhere in this codebase; slicing
    // the string keeps the slug agreeing with the stored value regardless of
    // where the admin who created it was sitting.
    expect(volunteerSheetSlug("Book Fair", "2026-01-02T03:00:00.000Z")).toBe("book-fair-2026-01-02");
  });

  it("falls back to the bare date when a title reduces to nothing", () => {
    expect(volunteerSheetSlug("春季音乐会", "2026-04-02T18:00:00.000Z")).toBe("2026-04-02");
  });

  it("folds accents and punctuation rather than dropping letters", () => {
    expect(volunteerSheetSlug("Año Nuevo Party!", "2026-01-05T18:00:00.000Z")).toBe(
      "ano-nuevo-party-2026-01-05",
    );
  });
});

describe("dedupeEvents and volunteer sheets", () => {
  const row = (over: Partial<CalendarRow>): CalendarRow => ({
    id: "e1", title: "Carnival", location: null, description: null,
    starts_at: "2026-10-17T22:00:00.000Z", ends_at: null, all_day: 0,
    source_id: "s1", source_name: "A", source_color: "#111111",
    managed_event_id: null, volunteer_slug: null, ...over,
  });

  it("keeps the slug when the same occurrence arrives on two calendars", () => {
    // A managed event syndicated to two feeds merges into one DTO. Whichever
    // copy carried the sheet, the surviving row must keep the link — otherwise
    // the volunteer affordance would blink in and out with row ordering.
    const out = dedupeEvents(
      [
        row({ id: "a", managed_event_id: "m1", source_id: "s1", volunteer_slug: null }),
        row({ id: "b", managed_event_id: "m1", source_id: "s2", volunteer_slug: "carnival-2026-10-17" }),
      ],
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.volunteerSlug).toBe("carnival-2026-10-17");
  });

  it("leaves an event with no sheet at null", () => {
    expect(dedupeEvents([row({})], 10)[0]!.volunteerSlug).toBeNull();
  });
});

describe("htmlToText", () => {
  it("turns <br> into newlines and strips other tags", () => {
    const html = "Cheese Pizza<br/>Turkey Pepperoni Pizza<br/>Veggie Pizza<br/>Caesar Salad<br/>Peaches";
    expect(htmlToText(html)).toBe("Cheese Pizza\nTurkey Pepperoni Pizza\nVeggie Pizza\nCaesar Salad\nPeaches");
  });
  it("decodes entities and drops markup", () => {
    expect(htmlToText("Soup &amp; Salad <b>today</b>")).toBe("Soup & Salad today");
    expect(htmlToText("Caf&#233; &#x1F355;")).toBe("Café 🍕");
  });
  it("leaves plain text essentially unchanged", () => {
    expect(htmlToText("Bring water bottles.")).toBe("Bring water bottles.");
  });
});
