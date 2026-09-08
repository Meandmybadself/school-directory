// Floating times, and the five-hour shift they caused in production.
//
// The district's feeds publish every timed event as a bare `DTSTART:` — no
// trailing Z, no TZID — and carry NO VTIMEZONE at all. RFC 5545 calls that a
// floating time: the reading on a wall clock wherever the event happens.
//
// ical.js resolves floating against the RUNTIME's zone. A Worker runs in UTC, so
// "6:30pm" was stored as 18:30Z and shown to a Central reader as 1:30pm. Nothing
// failed; the duration was even preserved. These tests are written against the
// real VEVENT that surfaced it (Superintendent's Listening & Learning Tour,
// 2026-09-14, published 18:30-20:00 floating).
//
// They also pin the case that made the fix necessary rather than cosmetic: the
// same input must produce the same instant no matter what TZ the test host is
// in, which is exactly what the old code could not promise.

import { describe, expect, it } from "vitest";
import { parseIcs } from "../src/lib/calendar.js";

const CHICAGO = "America/Chicago";

function feed(...vevents: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...vevents, "END:VCALENDAR"].join("\r\n");
}

const FLOATING = feed(
  "BEGIN:VEVENT",
  "UID:29309164@eisenhower.hopkinsschools.org",
  "DTSTART:20260914T183000",
  "DTEND:20260914T200000",
  "SUMMARY:Superintendent's Listening & Learning Tour 2026",
  "END:VEVENT",
);

const WINDOW: [Date, Date] = [new Date("2026-09-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z")];

describe("floating ICS times", () => {
  it("reads a floating time on the school's wall clock, not the runtime's", () => {
    const [e] = parseIcs(FLOATING, ...WINDOW, CHICAGO);
    // 6:30pm CDT is 23:30Z. The bug stored 18:30Z.
    expect(e!.start).toBe("2026-09-14T23:30:00.000Z");
    expect(e!.end).toBe("2026-09-15T01:00:00.000Z");
  });

  it("takes the wall clock from the argument, not from ambient state", () => {
    // The property the old code could not hold: the answer is a function of the
    // feed plus the zone we pass, and of nothing else. Asserting it by shoving
    // process.env.TZ around would test Node rather than this code — and would
    // not even do that reliably, since the runtime caches its zone. Two explicit
    // zones on identical input is the honest version of the same claim.
    const chicago = parseIcs(FLOATING, ...WINDOW, CHICAGO)[0]!;
    const tokyo = parseIcs(FLOATING, ...WINDOW, "Asia/Tokyo")[0]!;
    const utc = parseIcs(FLOATING, ...WINDOW, "UTC")[0]!;

    expect(chicago.start).toBe("2026-09-14T23:30:00.000Z"); // 18:30 CDT
    expect(tokyo.start).toBe("2026-09-14T09:30:00.000Z"); // 18:30 JST
    expect(utc.start).toBe("2026-09-14T18:30:00.000Z"); // what the bug produced
  });

  it("keeps the published duration", () => {
    const [e] = parseIcs(FLOATING, ...WINDOW, CHICAGO);
    const mins = (Date.parse(e!.end!) - Date.parse(e!.start)) / 60000;
    expect(mins).toBe(90);
  });

  it("still honours an explicit Z, which is already an instant", () => {
    const [e] = parseIcs(
      feed("BEGIN:VEVENT", "UID:z", "DTSTART:20260914T183000Z", "SUMMARY:zulu", "END:VEVENT"),
      ...WINDOW,
      CHICAGO,
    );
    expect(e!.start).toBe("2026-09-14T18:30:00.000Z");
  });

  it("honours a TZID whose VTIMEZONE the feed carries", () => {
    // An unregistered TZID silently degrades to floating in ical.js, which for a
    // feed in ANOTHER zone would be wrong by that zone's offset. Registering is
    // what makes this case correct rather than coincidentally close.
    const [e] = parseIcs(
      feed(
        "BEGIN:VTIMEZONE",
        "TZID:America/New_York",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:-0500",
        "TZOFFSETTO:-0400",
        "TZNAME:EDT",
        "DTSTART:19700308T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:-0400",
        "TZOFFSETTO:-0500",
        "TZNAME:EST",
        "DTSTART:19701101T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:ny",
        "DTSTART;TZID=America/New_York:20260914T183000",
        "SUMMARY:eastern",
        "END:VEVENT",
      ),
      ...WINDOW,
      CHICAGO,
    );
    // 6:30pm EDT, NOT 6:30pm Central — the school zone must not capture it.
    expect(e!.start).toBe("2026-09-14T22:30:00.000Z");
  });

  it("leaves all-day events on their published date", () => {
    const [e] = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:allday",
        "DTSTART;VALUE=DATE:20260915",
        "DTEND;VALUE=DATE:20260916",
        "SUMMARY:First Day of School",
        "END:VEVENT",
      ),
      ...WINDOW,
      CHICAGO,
    );
    // Midnight UTC, flagged all-day — the client renders these with timeZone
    // UTC, so shifting them into a zone here would move them a day.
    expect(e!.allDay).toBe(true);
    expect(e!.start).toBe("2026-09-15T00:00:00.000Z");
  });

  it("uses the offset in force on the day, across a DST boundary", () => {
    // CDT (-5) before Nov 1 2026, CST (-6) after. A single fixed offset would
    // get one of these wrong.
    const before = parseIcs(
      feed("BEGIN:VEVENT", "UID:a", "DTSTART:20261030T183000", "SUMMARY:cdt", "END:VEVENT"),
      ...WINDOW,
      CHICAGO,
    )[0]!;
    const after = parseIcs(
      feed("BEGIN:VEVENT", "UID:b", "DTSTART:20261105T183000", "SUMMARY:cst", "END:VEVENT"),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-12-01T00:00:00Z"),
      CHICAGO,
    )[0]!;
    expect(before.start).toBe("2026-10-30T23:30:00.000Z");
    expect(after.start).toBe("2026-11-06T00:30:00.000Z");
  });

  it("expands a recurring floating event on the school's clock every time", () => {
    const events = parseIcs(
      feed(
        "BEGIN:VEVENT",
        "UID:weekly",
        "DTSTART:20260914T183000",
        "DTEND:20260914T200000",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "SUMMARY:weekly floating",
        "END:VEVENT",
      ),
      ...WINDOW,
      CHICAGO,
    );
    expect(events.map((e) => e.start)).toEqual([
      "2026-09-14T23:30:00.000Z",
      "2026-09-21T23:30:00.000Z",
      "2026-09-28T23:30:00.000Z",
    ]);
  });
});
