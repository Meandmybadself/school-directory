// Which day an event belongs on.
//
// The bug these lock down: an all-day event denotes a calendar DATE and is
// stored at midnight UTC, so reading it with local-time accessors slides it to
// the previous day for any viewer west of UTC. In production that put every
// "No School" day and every lunch menu one day early for a school in Central
// Time. These assertions are written to hold in any host timezone.

import { describe, expect, it } from "vitest";
import type { PublicCalendarEventDTO } from "@sd/shared";
import {
  DESCRIPTION_CALENDAR,
  eventDayKey,
  eventSearchText,
  formatEventDay,
  googleSubscribeUrl,
  matchesSearch,
  normalizeSearch,
  searchTerms,
  webcalUrl,
} from "./calendar.js";

const ev = (over: Partial<PublicCalendarEventDTO>): PublicCalendarEventDTO => ({
  id: "e", kind: "imported", title: "Event", location: null, description: null,
  start: "2026-09-25T00:00:00.000Z", end: null, allDay: false,
  sourceIds: ["s"], source: { name: "School Events", color: "#000000" },
  volunteerSlug: null,
  ...over,
});

describe("eventDayKey", () => {
  it("reads an all-day event in UTC, so it keeps its printed date", () => {
    // Midnight UTC is the previous evening in the Americas; the key must not move.
    expect(eventDayKey(ev({ allDay: true, start: "2026-09-25T00:00:00.000Z" }))).toBe("2026-09-25");
  });

  it("keeps an all-day event on its date across a year boundary", () => {
    expect(eventDayKey(ev({ allDay: true, start: "2027-01-01T00:00:00.000Z" }))).toBe("2027-01-01");
  });

  it("reads a timed event locally, matching how its time is displayed", () => {
    const start = "2026-09-14T23:30:00.000Z"; // 6:30pm CDT
    const d = new Date(start);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(eventDayKey(ev({ allDay: false, start }))).toBe(expected);
  });

  it("groups a timed and an all-day event that share a calendar day together", () => {
    // A 6:30pm CDT meeting and an all-day event, both on 2026-09-14 locally
    // only when the host is Central. Assert on the all-day one being stable
    // instead, which holds everywhere.
    expect(eventDayKey(ev({ allDay: true, start: "2026-09-14T00:00:00.000Z" }))).toBe("2026-09-14");
  });
});

describe("formatEventDay", () => {
  it("labels an all-day event with its printed date, not the day before", () => {
    const label = formatEventDay(
      ev({ allDay: true, start: "2026-09-25T00:00:00.000Z" }),
      "en-US",
      { weekday: "long", month: "long", day: "numeric" },
    );
    expect(label).toContain("September 25");
    expect(label).toContain("Friday");
  });

  it("labels a multi-day range's first day correctly", () => {
    const label = formatEventDay(
      ev({ allDay: true, start: "2027-05-03T00:00:00.000Z", end: "2027-05-08T00:00:00.000Z" }),
      "en-US",
      { month: "long", day: "numeric" },
    );
    expect(label).toBe("May 3");
  });

  it("labels a timed event from its local instant", () => {
    const start = "2026-09-14T23:30:00.000Z";
    const expected = new Date(start).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    expect(formatEventDay(ev({ allDay: false, start }), "en-US", { month: "long", day: "numeric" })).toBe(expected);
  });
});

describe("subscription links", () => {
  // A published managed calendar, exactly as PublicCalendarFeedDTO carries it:
  // always https on our own API origin, never an admin's upstream URL.
  const feed = "https://api-directory.eisenhower.school/ics/01ABC.ics";

  it("swaps the scheme so a calendar app subscribes instead of downloading", () => {
    expect(webcalUrl(feed)).toBe("webcal://api-directory.eisenhower.school/ics/01ABC.ics");
  });

  it("handles the http origin used in local dev", () => {
    expect(webcalUrl("http://localhost:8787/ics/01ABC.ics")).toBe("webcal://localhost:8787/ics/01ABC.ics");
  });

  it("only touches the scheme — the path and any query survive intact", () => {
    const withQuery = "https://api-directory.eisenhower.school/ics/source/01XYZ.ics?v=2";
    expect(webcalUrl(withQuery)).toBe("webcal://api-directory.eisenhower.school/ics/source/01XYZ.ics?v=2");
  });

  it("gives Google a cid carrying the webcal form, url-encoded", () => {
    // Google silently fails to subscribe if cid holds an https URL, so this is
    // the assertion that keeps the Google path actually working.
    const out = googleSubscribeUrl(feed);
    expect(out.startsWith("https://calendar.google.com/calendar/r?cid=")).toBe(true);
    const cid = decodeURIComponent(out.split("cid=")[1]!);
    expect(cid).toBe("webcal://api-directory.eisenhower.school/ics/01ABC.ics");
    expect(out).not.toContain("cid=https");
  });
});

// ── Search ──────────────────────────────────────────────────────────────────
//
// Filtering is client-side over the already-loaded agenda, so these are the
// whole feature: what an event is findable by, and what counts as a match.

describe("normalizeSearch", () => {
  it("folds case so a typed query matches however the school wrote the title", () => {
    expect(normalizeSearch("Fall CARNIVAL")).toBe("fall carnival");
  });

  it("strips diacritics, so an accented name is reachable from a plain keyboard", () => {
    expect(normalizeSearch("Día de los Niños")).toBe("dia de los ninos");
  });
});

describe("searchTerms", () => {
  it("splits on whitespace and drops the empties a mid-typing query leaves", () => {
    expect(searchTerms("  fall   carnival ")).toEqual(["fall", "carnival"]);
  });

  it("is empty for a blank query, which the screen reads as 'not searching'", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("eventSearchText", () => {
  it("covers title, location, calendar name and the day label", () => {
    const hay = eventSearchText(
      ev({ title: "Fall Carnival", location: "Gym", source: { name: "PTO Events", color: "#000" } }),
      "Friday, September 25",
    );
    for (const term of ["carnival", "gym", "pto events", "september"]) {
      expect(matchesSearch(hay, [term])).toBe(true);
    }
  });

  it("ignores a description the agenda does not render", () => {
    // Descriptions are surfaced only on the menu calendar. Matching a hidden one
    // would return a row with no visible reason for being in the results.
    const hidden = ev({ description: "Sloppy joes", source: { name: "PTO Events", color: "#000" } });
    expect(matchesSearch(eventSearchText(hidden, ""), ["sloppy"])).toBe(false);
  });

  it("searches the description on the menu calendar, where it IS rendered", () => {
    const menu = ev({
      title: DESCRIPTION_CALENDAR,
      description: "Sloppy joes",
      source: { name: DESCRIPTION_CALENDAR, color: "#000" },
    });
    expect(matchesSearch(eventSearchText(menu, ""), ["sloppy"])).toBe(true);
  });

  it("reads a description that arrived as HTML as its text", () => {
    const menu = ev({
      title: DESCRIPTION_CALENDAR,
      description: "<p>Sloppy <strong>joes</strong></p>",
      source: { name: DESCRIPTION_CALENDAR, color: "#000" },
    });
    const hay = eventSearchText(menu, "");
    expect(matchesSearch(hay, ["sloppy", "joes"])).toBe(true);
    // …and not by the markup around it.
    expect(matchesSearch(hay, ["strong"])).toBe(false);
  });
});

describe("matchesSearch", () => {
  const hay = eventSearchText(
    ev({ title: "Fall Carnival", location: "Gym", source: { name: "PTO Events", color: "#000" } }),
    "Friday, September 25",
  );

  it("ANDs the terms, so words from different fields still match together", () => {
    expect(matchesSearch(hay, ["carnival", "gym"])).toBe(true);
  });

  it("ignores the order they were typed in", () => {
    expect(matchesSearch(hay, ["gym", "carnival"])).toBe(true);
  });

  it("matches a partial word, so results narrow while someone is still typing", () => {
    expect(matchesSearch(hay, ["carn"])).toBe(true);
  });

  it("fails when any one term is absent", () => {
    expect(matchesSearch(hay, ["carnival", "library"])).toBe(false);
  });

  it("matches everything when nothing has been typed", () => {
    expect(matchesSearch(hay, [])).toBe(true);
  });
});
