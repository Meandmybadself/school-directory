// The school's timezone: one configured zone, America/Chicago unless an
// instance says otherwise, and a typo in configuration degrades to that default
// rather than throwing out of every date on the page.
//
// The conversions are asserted against hardcoded instants rather than as
// round-trips, because the whole point is that the HOST's zone plays no part.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  isoToZonedDate,
  isoToZonedTime,
  resolveTimeZone,
  zonedDayStartUtc,
  zonedToIso,
} from "@sd/shared";

describe("resolveTimeZone", () => {
  it("defaults to America/Chicago", () => {
    expect(DEFAULT_TIME_ZONE).toBe("America/Chicago");
    expect(resolveTimeZone(undefined)).toBe("America/Chicago");
    expect(resolveTimeZone(null)).toBe("America/Chicago");
    expect(resolveTimeZone("")).toBe("America/Chicago");
    expect(resolveTimeZone("   ")).toBe("America/Chicago");
  });

  it("keeps a real zone and trims it", () => {
    expect(resolveTimeZone("America/Denver")).toBe("America/Denver");
    expect(resolveTimeZone(" America/New_York ")).toBe("America/New_York");
  });

  it("falls back rather than throwing on a zone that doesn't exist", () => {
    expect(isValidTimeZone("America/Chicgo")).toBe(false);
    expect(resolveTimeZone("America/Chicgo")).toBe("America/Chicago");
    expect(resolveTimeZone("Central")).toBe("America/Chicago");
  });
});

describe("wall clock ↔ instant", () => {
  const tz = "America/Chicago";

  it("converts in both halves of the year", () => {
    expect(zonedToIso("2026-09-18", "17:30", tz)).toBe("2026-09-18T22:30:00.000Z"); // CDT
    expect(zonedToIso("2026-12-03", "17:30", tz)).toBe("2026-12-03T23:30:00.000Z"); // CST
  });

  it("reads an instant back as the school's date and time", () => {
    // 03:00 UTC on the 19th is still 10pm on the 18th in Chicago.
    expect(isoToZonedDate("2026-09-19T03:00:00.000Z", tz)).toBe("2026-09-18");
    expect(isoToZonedTime("2026-09-19T03:00:00.000Z", tz)).toBe("22:00");
    // Midnight is 00, never 24.
    expect(isoToZonedTime("2026-09-19T05:00:00.000Z", tz)).toBe("00:00");
  });

  it("round-trips across both DST boundaries", () => {
    for (const date of ["2026-03-08", "2026-11-01"]) {
      for (const time of ["00:00", "12:00", "23:45"]) {
        const iso = zonedToIso(date, time, tz);
        expect(isoToZonedDate(iso, tz)).toBe(date);
        expect(isoToZonedTime(iso, tz)).toBe(time);
      }
    }
  });

  it("still agrees with the newsletter's day boundary", () => {
    expect(zonedDayStartUtc("2026-09-18", tz)).toBe("2026-09-18T05:00:00.000Z");
    expect(zonedDayStartUtc("2026-12-03", tz)).toBe("2026-12-03T06:00:00.000Z");
  });
});
