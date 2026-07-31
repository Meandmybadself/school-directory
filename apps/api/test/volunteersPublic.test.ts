// The public/private seam for volunteer sheets — the companion to
// calendarPublic.test.ts, and written for the same reason: to fail loudly when
// someone widens VolunteerSheetDTO and the new field reaches an anonymous
// reader.
//
// This seam guards something calendarPublic.test.ts does not: NAMES. A sheet's
// URL is human-readable and enumerable by design (it has to open from a text
// message), so a volunteer's name reaching this response would put a member's
// name on the open internet. The assertions below therefore check both the
// shape (exact key sets, at three levels) and the payload (no name, note or
// person id survives anywhere in the serialized JSON).

import { describe, expect, it } from "vitest";
import type { VolunteerSheetDTO } from "@sd/shared";
import { publicSheetOf } from "../src/lib/volunteers.js";

/** Every key an anonymous caller may see at the top level. Changing these lists
 *  is a deliberate act — if a test failure sent you here, confirm the new field
 *  is genuinely safe for a logged-out stranger before adding it. */
const SHEET_KEYS = ["slug", "intro", "closesAt", "closed", "event", "positions"].sort();
const EVENT_KEYS = ["title", "location", "description", "start", "end", "allDay"].sort();
const POSITION_KEYS = ["id", "title", "description", "slots", "filled", "startsAt", "endsAt"].sort();

function sheet(): VolunteerSheetDTO {
  return {
    id: "01SHEET",
    slug: "fall-carnival-2026-10-17",
    intro: "Help us run the carnival.",
    closesAt: "2026-10-16T05:00:00.000Z",
    closed: false,
    published: true,
    event: {
      seriesId: "01SERIES",
      recurrenceId: "2026-10-17T22:00:00.000Z",
      title: "Fall Carnival",
      location: "Gym",
      description: "Doors at 5.",
      start: "2026-10-17T22:00:00.000Z",
      end: "2026-10-18T02:00:00.000Z",
      allDay: false,
    },
    positions: [
      {
        id: "01POS",
        title: "Snack table",
        description: "Serve popcorn.",
        slots: 4,
        filled: 2,
        startsAt: "2026-10-17T22:00:00.000Z",
        endsAt: "2026-10-18T00:00:00.000Z",
        signups: [
          {
            id: "01SIGNUP",
            personId: "01PERSON",
            displayName: "Dana R.",
            note: "I'll bring the cooler",
            isYou: false,
            createdAt: "2026-10-01T12:00:00.000Z",
          },
        ],
      },
    ],
    canManage: true,
  };
}

describe("publicSheetOf", () => {
  it("emits exactly the public key set and nothing else", () => {
    const pub = publicSheetOf(sheet());
    expect(Object.keys(pub).sort()).toEqual(SHEET_KEYS);
    expect(Object.keys(pub.event).sort()).toEqual(EVENT_KEYS);
    expect(Object.keys(pub.positions[0]!).sort()).toEqual(POSITION_KEYS);
  });

  it("never publishes who signed up", () => {
    // The single most important assertion in this file. Counts are public;
    // names are members-only (CLAUDE.md invariant 1).
    const pub = publicSheetOf(sheet());
    expect(pub.positions[0]).not.toHaveProperty("signups");
    const json = JSON.stringify(pub);
    expect(json).not.toContain("Dana");
    expect(json).not.toContain("01PERSON");
    expect(json).not.toContain("cooler");
  });

  it("still publishes the counts, which are the point of the page", () => {
    const pub = publicSheetOf(sheet());
    expect(pub.positions[0]!.filled).toBe(2);
    expect(pub.positions[0]!.slots).toBe(4);
  });

  it("withholds the durable handle that addresses signup data", () => {
    const pub = publicSheetOf(sheet());
    // Same rule as publicEventOf: (seriesId, recurrenceId) is the pair a signup
    // is keyed on, so it stays out of unauthenticated responses. The instant
    // itself still goes out as `start` — the public agenda publishes that too.
    expect(pub.event).not.toHaveProperty("seriesId");
    expect(pub.event).not.toHaveProperty("recurrenceId");
    expect(JSON.stringify(pub)).not.toContain("01SERIES");
    expect(pub.event.start).toBe("2026-10-17T22:00:00.000Z");
  });

  it("withholds the sheet's internal id and admin state", () => {
    const pub = publicSheetOf(sheet());
    expect(pub).not.toHaveProperty("id");
    expect(pub).not.toHaveProperty("canManage");
    expect(pub).not.toHaveProperty("published");
    expect(pub).not.toHaveProperty("orphaned");
  });

  it("does not let a newly added DTO field ride along", () => {
    // Models a future widening of VolunteerSheetDTO. A spread-based
    // implementation would leak these; a hand-built one cannot.
    // Through `unknown`: the nested extra property puts this beyond what a
    // direct assertion allows, which is the whole point — this is a shape the
    // type system does not yet know about.
    const widened = {
      ...sheet(),
      organizerEmail: "pto-chair@example.com",
      positions: [{ ...sheet().positions[0]!, waitlist: ["someone@example.com"] }],
    } as unknown as VolunteerSheetDTO;

    const pub = publicSheetOf(widened);
    expect(pub).not.toHaveProperty("organizerEmail");
    expect(pub.positions[0]).not.toHaveProperty("waitlist");
    expect(Object.keys(pub).sort()).toEqual(SHEET_KEYS);
    expect(Object.keys(pub.positions[0]!).sort()).toEqual(POSITION_KEYS);
    expect(JSON.stringify(pub)).not.toContain("example.com");
  });

  it("preserves nulls rather than dropping the keys", () => {
    const base = sheet();
    const pub = publicSheetOf({
      ...base,
      intro: null,
      closesAt: null,
      event: { ...base.event, location: null, description: null, end: null },
      positions: [{ ...base.positions[0]!, description: null, startsAt: null, endsAt: null }],
    });
    expect(pub.intro).toBeNull();
    expect(pub.closesAt).toBeNull();
    expect(pub.event.location).toBeNull();
    expect(pub.positions[0]!.startsAt).toBeNull();
    expect(Object.keys(pub).sort()).toEqual(SHEET_KEYS);
    expect(Object.keys(pub.event).sort()).toEqual(EVENT_KEYS);
    expect(Object.keys(pub.positions[0]!).sort()).toEqual(POSITION_KEYS);
  });

  it("carries the closed verdict so the page can say signups are over", () => {
    expect(publicSheetOf({ ...sheet(), closed: true }).closed).toBe(true);
  });
});
