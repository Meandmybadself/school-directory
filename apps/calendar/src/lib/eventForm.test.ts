// Conversions between the event form and the API payload. Timed values are the
// SCHOOL'S wall clock (America/Chicago by default), never the host's, so these
// assertions hold in any host timezone — run them with TZ=Asia/Tokyo to see.

import { describe, expect, it } from "vitest";
import type { ManagedEventDTO } from "@sd/shared";
import {
  dateToIso,
  emptyForm,
  formFromEvent,
  isoToSchoolDate,
  isoToSchoolTime,
  schoolToIso,
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
    const iso = schoolToIso("2026-09-18", "17:30");
    expect(isoToSchoolDate(iso)).toBe("2026-09-18");
    expect(isoToSchoolTime(iso)).toBe("17:30");
  });

  it("round-trips local times across both DST boundaries", () => {
    for (const date of ["2026-03-08", "2026-11-01", "2026-06-15", "2026-01-15"]) {
      const iso = schoolToIso(date, "14:05");
      expect(isoToSchoolDate(iso)).toBe(date);
      expect(isoToSchoolTime(iso)).toBe("14:05");
    }
  });

  it("reads timed values as the school's wall clock, not the host's", () => {
    // 5:30pm in Chicago in September is CDT, UTC-5.
    expect(schoolToIso("2026-09-18", "17:30")).toBe("2026-09-18T22:30:00.000Z");
    // ...and CST, UTC-6, once daylight saving ends.
    expect(schoolToIso("2026-12-03", "17:30")).toBe("2026-12-03T23:30:00.000Z");
    expect(isoToSchoolDate("2026-09-19T03:00:00.000Z")).toBe("2026-09-18");
    expect(isoToSchoolTime("2026-09-19T03:00:00.000Z")).toBe("22:00");
  });

  it("honours an explicitly configured zone", () => {
    expect(schoolToIso("2026-09-18", "17:30", "America/New_York")).toBe("2026-09-18T21:30:00.000Z");
    expect(isoToSchoolTime("2026-09-18T21:30:00.000Z", "America/Los_Angeles")).toBe("14:30");
  });

  it("uses midnight UTC for an all-day UNTIL so the emitted DATE is that day", () => {
    expect(untilToIso("2026-12-18", true)).toBe("2026-12-18T00:00:00.000Z");
  });

  it("uses the school's end of day for a timed UNTIL, so a late occurrence still counts", () => {
    // An 8pm event's UTC instant falls on the following day; UNTIL therefore
    // has to be the END of the chosen school day, not its midnight.
    const until = untilToIso("2026-12-18", false);
    const lastOccurrence = schoolToIso("2026-12-18", "20:00");
    expect(new Date(until).getTime()).toBeGreaterThan(new Date(lastOccurrence).getTime());
    expect(isoToSchoolDate(until)).toBe("2026-12-18");
    expect(until).toBe("2026-12-19T05:59:59.999Z");
  });
});

describe("toInput", () => {
  it("sends a timed event as UTC instants matching the local wall clock", () => {
    const input = toInput(form());
    expect(input.allDay).toBe(false);
    expect(isoToSchoolTime(input.start)).toBe("17:30");
    expect(isoToSchoolTime(input.end!)).toBe("20:00");
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
    const input = toInput(form({ location: "  ", description: "", meetingUrl: " " }));
    expect(input.location).toBeNull();
    expect(input.description).toBeNull();
    expect(input.meetingUrl).toBeNull();
  });

  it("sends the meeting link trimmed", () => {
    expect(toInput(form({ meetingUrl: " https://meet.google.com/abc-defg-hij " })).meetingUrl).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
  });
});

describe("validateForm", () => {
  it("accepts a well-formed event", () => {
    expect(validateForm(form())).toBeNull();
    expect(validateForm(form({ meetingUrl: "https://meet.google.com/abc-defg-hij" }))).toBeNull();
  });

  it("catches a meeting link pasted without its scheme, before the round trip", () => {
    expect(validateForm(form({ meetingUrl: "meet.google.com/abc-defg-hij" }))).toMatch(/https:\/\//);
    expect(validateForm(form({ meetingUrl: "javascript:alert(1)" }))).toMatch(/https:\/\//);
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
    meetingUrl: null,
    start: "2026-09-18T00:00:00.000Z",
    end: "2026-09-21T00:00:00.000Z",
    allDay: true,
    recurrence: null,
    occurrenceCount: 1,
    sheetCount: 0,
    signupCount: 0,
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
    const start = schoolToIso("2026-09-18", "17:30");
    const end = schoolToIso("2026-09-18", "20:00");
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
    const f = formFromEvent(dto({ allDay: false, start: schoolToIso("2026-09-18", "17:30"), end: null }));
    expect(f.endTime).toBe("");
    expect(f.endDate).toBe("2026-09-18");
  });
});

// The bug this pins, reported from the admin UI: editing "PTO General Meeting -
// Sept" to move it to 2026-09-28 answered "End must be on or after the start."
//
// The timed editor shows ONE date input, bound to `startDate`, plus a start and
// end time. `formFromEvent` nevertheless fills `endDate` from the event being
// edited, and `toInput` used to read it — so changing the date sent the NEW
// start with the OLD end, and the API's range check refused it. There is no
// end-date field for the admin to fix, which is what made it a dead end rather
// than a nuisance. `validateForm` did not catch it either: its end-before-start
// check is gated on `allDay`.
describe("moving a timed event's date", () => {
  const meeting: ManagedEventDTO = {
    id: "01EVENT",
    calendarId: "01CAL",
    title: "PTO General Meeting - Sept",
    location: null,
    description: null,
    meetingUrl: null,
    start: schoolToIso("2026-09-14", "18:30"),
    end: schoolToIso("2026-09-14", "20:00"),
    allDay: false,
    recurrence: null,
  } as ManagedEventDTO;

  it("carries the end onto the new date", () => {
    const moved = { ...formFromEvent(meeting), startDate: "2026-09-28" };
    const input = toInput(moved);
    expect(isoToSchoolDate(input.start)).toBe("2026-09-28");
    // The whole bug: this used to come back as 2026-09-14.
    expect(isoToSchoolDate(input.end!)).toBe("2026-09-28");
    expect(isoToSchoolTime(input.end!)).toBe("20:00");
    expect(new Date(input.end!).getTime()).toBeGreaterThan(new Date(input.start).getTime());
  });

  it("no longer builds a payload the API would refuse", () => {
    // The server-side rule, restated here so this test fails for the reason the
    // admin actually saw rather than only on a date string.
    const moved = { ...formFromEvent(meeting), startDate: "2026-09-28" };
    const input = toInput(moved);
    expect(new Date(input.end!).getTime()).toBeGreaterThanOrEqual(new Date(input.start).getTime());
  });

  it("still lets a timed event run past local midnight", () => {
    // The one case the old `endDate` handled correctly, and the reason the fix
    // rolls forward a day instead of just clamping to the start's date.
    const input = toInput(form({ startDate: "2026-09-18", startTime: "21:00", endTime: "01:00" }));
    expect(isoToSchoolDate(input.end!)).toBe("2026-09-19");
    expect(new Date(input.end!).getTime()).toBeGreaterThan(new Date(input.start).getTime());
  });

  it("treats equal start and end times as zero-length, not 24 hours", () => {
    const input = toInput(form({ startDate: "2026-09-18", startTime: "19:00", endTime: "19:00" }));
    expect(input.end).toBe(input.start);
  });

  it("is unaffected for all-day events, which do own an end-date field", () => {
    const input = toInput(form({ allDay: true, startDate: "2026-09-18", endDate: "2026-09-20" }));
    // Exclusive end: the day after the inclusive last day.
    expect(input.end).toBe("2026-09-21T00:00:00.000Z");
  });
});
