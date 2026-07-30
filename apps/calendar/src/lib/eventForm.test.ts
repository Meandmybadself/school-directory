// Conversions between the event form and the API payload. These assertions are
// written to hold in ANY host timezone: the all-day rules are absolute (midnight
// UTC, exclusive end), and the timed rules are checked as round-trips rather
// than against hardcoded offsets.

import { describe, expect, it } from "vitest";
import type { ManagedEventDTO } from "@sd/shared";
import {
  dateToIso,
  emptyForm,
  formFromEvent,
  isoToLocalDate,
  isoToLocalTime,
  localToIso,
  shiftDate,
  toInput,
  untilToIso,
  validateForm,
  type EventForm,
} from "./eventForm.js";

const form = (over: Partial<EventForm> = {}): EventForm => ({
  ...emptyForm(),
  title: "Fall Carnival",
  startDate: "2026-09-18",
  startTime: "17:30",
  endDate: "2026-09-18",
  endTime: "20:00",
  ...over,
});

describe("date helpers", () => {
  it("treats an all-day date as midnight UTC", () => {
    expect(dateToIso("2026-09-18")).toBe("2026-09-18T00:00:00.000Z");
  });

  it("shifts dates in UTC, so no DST transition can move the day", () => {
    expect(shiftDate("2026-09-18", 1)).toBe("2026-09-19");
    expect(shiftDate("2026-09-18", -1)).toBe("2026-09-17");
    // US DST ends 2026-11-01; a local-time shift here could land back on the 1st.
    expect(shiftDate("2026-11-01", 1)).toBe("2026-11-02");
    expect(shiftDate("2026-03-08", 1)).toBe("2026-03-09");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("round-trips a local date and time through UTC", () => {
    const iso = localToIso("2026-09-18", "17:30");
    expect(isoToLocalDate(iso)).toBe("2026-09-18");
    expect(isoToLocalTime(iso)).toBe("17:30");
  });

  it("round-trips local times across both DST boundaries", () => {
    for (const date of ["2026-03-08", "2026-11-01", "2026-06-15", "2026-01-15"]) {
      const iso = localToIso(date, "14:05");
      expect(isoToLocalDate(iso)).toBe(date);
      expect(isoToLocalTime(iso)).toBe("14:05");
    }
  });

  it("uses midnight UTC for an all-day UNTIL so the emitted DATE is that day", () => {
    expect(untilToIso("2026-12-18", true)).toBe("2026-12-18T00:00:00.000Z");
  });

  it("uses the local end of day for a timed UNTIL, so a late occurrence still counts", () => {
    // An 8pm event's UTC instant can fall on the following day; UNTIL therefore
    // has to be the END of the chosen local day, not its midnight.
    const until = untilToIso("2026-12-18", false);
    const lastOccurrence = localToIso("2026-12-18", "20:00");
    expect(new Date(until).getTime()).toBeGreaterThan(new Date(lastOccurrence).getTime());
    expect(isoToLocalDate(until)).toBe("2026-12-18");
  });
});

describe("toInput", () => {
  it("sends a timed event as UTC instants matching the local wall clock", () => {
    const input = toInput(form());
    expect(input.allDay).toBe(false);
    expect(isoToLocalTime(input.start)).toBe("17:30");
    expect(isoToLocalTime(input.end!)).toBe("20:00");
    expect(input.recurrence).toBeNull();
  });

  it("omits the end when no end time was given", () => {
    expect(toInput(form({ endTime: "" })).end).toBeNull();
  });

  it("converts a one-day all-day event to an exclusive next-midnight end", () => {
    const input = toInput(form({ allDay: true, startDate: "2026-09-18", endDate: "2026-09-18" }));
    expect(input.start).toBe("2026-09-18T00:00:00.000Z");
    expect(input.end).toBe("2026-09-19T00:00:00.000Z");
    expect(input.allDay).toBe(true);
  });

  it("converts a multi-day all-day event's inclusive last day to an exclusive end", () => {
    const input = toInput(form({ allDay: true, startDate: "2026-09-18", endDate: "2026-09-20" }));
    expect(input.start).toBe("2026-09-18T00:00:00.000Z");
    expect(input.end).toBe("2026-09-21T00:00:00.000Z");
  });

  it("builds a weekly recurrence with the chosen days", () => {
    const input = toInput(form({ repeat: "weekly", byDay: ["TU", "TH"], interval: "2", untilDate: "2026-12-18" }));
    expect(input.recurrence).toMatchObject({ freq: "weekly", interval: 2, byDay: ["TU", "TH"] });
  });

  it("leaves byDay off a non-weekly recurrence", () => {
    const input = toInput(form({ repeat: "monthly", byDay: ["TU"], untilDate: "2026-12-18" }));
    expect(input.recurrence).toMatchObject({ freq: "monthly" });
    expect(input.recurrence).not.toHaveProperty("byDay");
  });

  it("trims optional text to null rather than sending empty strings", () => {
    const input = toInput(form({ location: "  ", description: "" }));
    expect(input.location).toBeNull();
    expect(input.description).toBeNull();
  });
});

describe("validateForm", () => {
  it("accepts a well-formed event", () => {
    expect(validateForm(form())).toBeNull();
    expect(validateForm(form({ repeat: "weekly", byDay: ["MO"], untilDate: "2026-12-18" }))).toBeNull();
  });

  it("requires a title and a start", () => {
    expect(validateForm(form({ title: " " }))).toMatch(/title/i);
    expect(validateForm(form({ startTime: "" }))).toMatch(/start time/i);
  });

  it("rejects an all-day range that ends before it starts", () => {
    expect(validateForm(form({ allDay: true, startDate: "2026-09-18", endDate: "2026-09-17" }))).toMatch(/before/i);
  });

  it("requires a weekday for a weekly repeat", () => {
    expect(validateForm(form({ repeat: "weekly", byDay: [], untilDate: "2026-12-18" }))).toMatch(/weekday/i);
  });

  it("requires the repeat to end on or after the start", () => {
    expect(validateForm(form({ repeat: "daily", untilDate: "2026-09-01" }))).toMatch(/on or after/i);
  });

  it("rejects a non-positive interval", () => {
    expect(validateForm(form({ repeat: "daily", interval: "0", untilDate: "2026-12-18" }))).toMatch(/whole number/i);
  });
});

describe("formFromEvent", () => {
  const dto = (over: Partial<ManagedEventDTO> = {}): ManagedEventDTO => ({
    id: "01J",
    calendarId: "01C",
    title: "Fall Carnival",
    location: "Gym",
    description: null,
    start: "2026-09-18T00:00:00.000Z",
    end: "2026-09-21T00:00:00.000Z",
    allDay: true,
    recurrence: null,
    occurrenceCount: 1,
    createdBy: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  });

  it("shows an all-day event's stored exclusive end as an inclusive last day", () => {
    const f = formFromEvent(dto());
    expect(f.startDate).toBe("2026-09-18");
    expect(f.endDate).toBe("2026-09-20");
    expect(f.allDay).toBe(true);
  });

  it("round-trips an all-day event through the form unchanged", () => {
    const input = toInput(formFromEvent(dto()));
    expect(input.start).toBe("2026-09-18T00:00:00.000Z");
    expect(input.end).toBe("2026-09-21T00:00:00.000Z");
  });

  it("round-trips a timed recurring event through the form unchanged", () => {
    const start = localToIso("2026-09-18", "17:30");
    const end = localToIso("2026-09-18", "20:00");
    const until = untilToIso("2026-12-18", false);
    const input = toInput(
      formFromEvent(
        dto({
          allDay: false,
          start,
          end,
          recurrence: { freq: "weekly", interval: 2, byDay: ["TU", "TH"], until },
        }),
      ),
    );
    expect(input.start).toBe(start);
    expect(input.end).toBe(end);
    expect(input.recurrence).toMatchObject({ freq: "weekly", interval: 2, byDay: ["TU", "TH"], until });
  });

  it("falls back to the start date when the event has no end", () => {
    const f = formFromEvent(dto({ allDay: false, start: localToIso("2026-09-18", "17:30"), end: null }));
    expect(f.endTime).toBe("");
    expect(f.endDate).toBe("2026-09-18");
  });
});
