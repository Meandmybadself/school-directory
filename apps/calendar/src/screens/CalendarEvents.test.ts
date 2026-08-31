// The upcoming/past split on the calendar's event page. The interesting case is
// a recurring series: it has to stay "upcoming" until its LAST occurrence has
// passed, not its first — otherwise an active weekly event files itself under
// "past" the week after it started.

import { describe, expect, it } from "vitest";
import type { ManagedEventDTO } from "@sd/shared";
import { partition } from "./CalendarEvents.js";

const NOW = new Date("2026-09-20T12:00:00.000Z").getTime();

const evt = (over: Partial<ManagedEventDTO>): ManagedEventDTO => ({
  id: "e", calendarId: "c", title: "Event", location: null, description: null,
  start: "2026-09-20T12:00:00.000Z", end: null, allDay: false, recurrence: null,
  occurrenceCount: 1, sheetCount: 0, signupCount: 0, createdBy: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("partition", () => {
  it("files a future one-off under upcoming and a finished one under past", () => {
    const future = evt({ id: "future", start: "2026-10-01T12:00:00.000Z" });
    const done = evt({ id: "done", start: "2026-08-01T12:00:00.000Z" });
    const { upcoming, past } = partition([done, future], NOW);
    expect(upcoming.map((e) => e.id)).toEqual(["future"]);
    expect(past.map((e) => e.id)).toEqual(["done"]);
  });

  it("keeps a started-but-unfinished recurring series in upcoming", () => {
    // Began in the past, still running for months — the whole point of the fix.
    const weekly = evt({
      id: "weekly",
      start: "2026-08-04T20:00:00.000Z",
      recurrence: { freq: "weekly", interval: 1, until: "2026-12-18T23:59:59.999Z" },
    });
    const { upcoming, past } = partition([weekly], NOW);
    expect(upcoming.map((e) => e.id)).toEqual(["weekly"]);
    expect(past).toEqual([]);
  });

  it("files a fully-elapsed recurring series under past", () => {
    const ended = evt({
      id: "ended",
      start: "2026-01-06T20:00:00.000Z",
      recurrence: { freq: "weekly", interval: 1, until: "2026-05-26T23:59:59.999Z" },
    });
    const { upcoming, past } = partition([ended], NOW);
    expect(upcoming).toEqual([]);
    expect(past.map((e) => e.id)).toEqual(["ended"]);
  });

  it("uses the end, not the start, for an event running across now", () => {
    // Multi-day all-day event that started yesterday and ends tomorrow.
    const spanning = evt({
      id: "spanning",
      allDay: true,
      start: "2026-09-19T00:00:00.000Z",
      end: "2026-09-22T00:00:00.000Z",
    });
    expect(partition([spanning], NOW).upcoming.map((e) => e.id)).toEqual(["spanning"]);
  });

  it("treats an event ending exactly now as still upcoming", () => {
    const boundary = evt({ id: "boundary", start: "2026-09-20T12:00:00.000Z" });
    expect(partition([boundary], NOW).upcoming.map((e) => e.id)).toEqual(["boundary"]);
  });

  it("sorts upcoming soonest-first and past most-recent-first", () => {
    const events = [
      evt({ id: "u2", start: "2026-11-01T12:00:00.000Z" }),
      evt({ id: "p2", start: "2026-07-01T12:00:00.000Z" }),
      evt({ id: "u1", start: "2026-10-01T12:00:00.000Z" }),
      evt({ id: "p1", start: "2026-08-01T12:00:00.000Z" }),
    ];
    const { upcoming, past } = partition(events, NOW);
    expect(upcoming.map((e) => e.id)).toEqual(["u1", "u2"]);
    expect(past.map((e) => e.id)).toEqual(["p1", "p2"]);
  });

  it("handles an empty list", () => {
    expect(partition([], NOW)).toEqual({ upcoming: [], past: [] });
  });
});
