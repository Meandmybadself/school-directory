// The admin summary line for an event's schedule.
//
// The trap: an event's UNTIL is stored to match its kind — midnight UTC for an
// all-day series, the local END of the chosen day for a timed one (so a
// late-evening occurrence still falls inside it). Formatting both in UTC made a
// timed rule report the day AFTER the one the admin picked.

import { describe, expect, it } from "vitest";
import type { ManagedEventDTO } from "@sd/shared";
import { describeEvent, occurrenceAction } from "./adminUi.js";
import { untilToIso } from "../lib/eventForm.js";

const ev = (over: Partial<ManagedEventDTO>): ManagedEventDTO => ({
  id: "e", calendarId: "c", title: "Event", location: null, description: null,
  start: "2026-07-30T17:00:00.000Z", end: null, allDay: false, recurrence: null,
  occurrenceCount: 1, sheetCount: 0, signupCount: 0, createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("describeEvent", () => {
  it("reports a timed rule's UNTIL as the day the admin actually picked", () => {
    // untilToIso stores the LOCAL end of Aug 29; formatting that in UTC would
    // read as Aug 30 for anyone west of UTC.
    const out = describeEvent(ev({
      recurrence: { freq: "weekly", interval: 1, byDay: ["TU", "TH"], until: untilToIso("2026-08-29", false) },
    }));
    expect(out).toContain("until Aug 29, 2026");
    expect(out).not.toContain("Aug 30");
  });

  it("reports an all-day rule's UNTIL as its printed day", () => {
    const out = describeEvent(ev({
      allDay: true,
      start: "2026-09-25T00:00:00.000Z",
      recurrence: { freq: "weekly", interval: 1, until: untilToIso("2026-12-18", true) },
    }));
    expect(out).toContain("until Dec 18, 2026");
  });

  it("names the weekdays of a weekly rule", () => {
    const out = describeEvent(ev({
      recurrence: { freq: "weekly", interval: 1, byDay: ["TU", "TH"], until: untilToIso("2026-08-29", false) },
    }));
    expect(out).toContain("weekly on TU, TH");
  });

  it("spells out an interval greater than one", () => {
    const out = describeEvent(ev({
      recurrence: { freq: "weekly", interval: 2, byDay: ["MO"], until: untilToIso("2026-08-29", false) },
    }));
    expect(out).toContain("every 2 weeks");
  });

  it("marks a non-recurring all-day event", () => {
    expect(describeEvent(ev({ allDay: true, start: "2026-09-25T00:00:00.000Z" }))).toContain("Sep 25, 2026");
    expect(describeEvent(ev({ allDay: true, start: "2026-09-25T00:00:00.000Z" }))).toContain("all day");
  });
});

// The occurrence row's button on the volunteer-signups screen.
//
// Reported as "clicking Open does nothing". It was worse than a dead button: the
// two labels were inverted against their meaning. The row you COULD act on read
// "Manage", and the row already loaded in the panel read "Open" — whose handler
// re-fetched that same sheet into the same state, so nothing changed on screen.
describe("occurrenceAction", () => {
  it("offers creation when the date has no sheet yet", () => {
    expect(occurrenceAction(undefined, null)).toBe("create");
    expect(occurrenceAction(null, "sheet-1")).toBe("create");
  });

  it("offers to open a sheet that is not the one loaded", () => {
    expect(occurrenceAction("sheet-2", "sheet-1")).toBe("open");
    expect(occurrenceAction("sheet-2", null)).toBe("open");
  });

  it("reports state, not an action, for the sheet already loaded", () => {
    // The regression itself: this case used to render a button.
    expect(occurrenceAction("sheet-1", "sheet-1")).toBe("editing");
  });

  it("never calls a row 'open' and 'editing' at once", () => {
    const ids = ["a", "b", null, undefined] as const;
    for (const row of ids) {
      for (const open of ids) {
        const a = occurrenceAction(row, open);
        expect(["create", "open", "editing"]).toContain(a);
        if (a === "editing") expect(row).toBe(open);
      }
    }
  });
});
