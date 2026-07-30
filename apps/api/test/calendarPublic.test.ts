// The public/private seam for calendar events.
//
// These tests exist to fail loudly when someone widens CalendarEventDTO and the
// new field reaches the anonymous agenda. The key assertion is an EXACT key-set
// match rather than a list of `not.toHaveProperty` checks: the latter only ever
// catches fields you already thought of, which is precisely the failure mode
// this seam is meant to prevent.

import { describe, expect, it } from "vitest";
import type { CalendarEventDTO } from "@sd/shared";
import { listPublicCalendarFeeds, publicEventOf } from "../src/lib/calendar.js";
import type { Env } from "../src/env.js";

/** Every key an anonymous caller may see. Changing this list is a deliberate
 *  act — if a test failure sent you here, confirm the new field is genuinely
 *  safe for a logged-out stranger before adding it. */
const PUBLIC_KEYS = [
  "id",
  "kind",
  "title",
  "location",
  "description",
  "start",
  "end",
  "allDay",
  "sourceIds",
  "source",
].sort();

function managedEvent(): CalendarEventDTO {
  return {
    id: "01EVENT",
    kind: "managed",
    seriesId: "01SERIES",
    recurrenceId: "2026-09-10T18:00:00.000Z",
    title: "General Meeting - Sept",
    location: "Media Center, Eisenhower Elementary",
    description: "Doors at 6:30.",
    start: "2026-09-10T18:00:00.000Z",
    end: "2026-09-10T19:30:00.000Z",
    allDay: false,
    sourceIds: ["01CAL"],
    source: { name: "PTO events", color: "#0068A8" },
  };
}

describe("publicEventOf", () => {
  it("emits exactly the public key set and nothing else", () => {
    expect(Object.keys(publicEventOf(managedEvent())).sort()).toEqual(PUBLIC_KEYS);
  });

  it("withholds the durable handles a volunteer signup would key on", () => {
    const pub = publicEventOf(managedEvent());
    // Not merely unused by the UI — absent from the wire, so member signup data
    // keyed on (seriesId, recurrenceId) can never be addressed from a public
    // response. See CLAUDE.md invariant 8.
    expect(pub).not.toHaveProperty("seriesId");
    expect(pub).not.toHaveProperty("recurrenceId");
  });

  it("does not let a newly added DTO field ride along", () => {
    // Models a future widening of CalendarEventDTO (e.g. volunteer signups)
    // without waiting for that feature to exist. A spread-based implementation
    // would leak this; a hand-built one cannot.
    const withFutureField = {
      ...managedEvent(),
      signups: [{ name: "A Parent", email: "parent@example.com" }],
    } as CalendarEventDTO;

    const pub = publicEventOf(withFutureField);
    expect(pub).not.toHaveProperty("signups");
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
    expect(JSON.stringify(pub)).not.toContain("parent@example.com");
  });

  it("passes through the fields the agenda actually renders", () => {
    const pub = publicEventOf(managedEvent());
    expect(pub.title).toBe("General Meeting - Sept");
    expect(pub.location).toBe("Media Center, Eisenhower Elementary");
    expect(pub.description).toBe("Doors at 6:30.");
    expect(pub.source).toEqual({ name: "PTO events", color: "#0068A8" });
    expect(pub.sourceIds).toEqual(["01CAL"]);
  });

  it("preserves nulls rather than dropping the keys", () => {
    const pub = publicEventOf({ ...managedEvent(), location: null, description: null, end: null });
    expect(pub.location).toBeNull();
    expect(pub.description).toBeNull();
    expect(pub.end).toBeNull();
    expect(Object.keys(pub).sort()).toEqual(PUBLIC_KEYS);
  });
});

/** Minimal D1 stand-in: the two SELECTs in calendarFeedRows are distinguished by
 *  which table they name, which is all this needs to fake. */
function envWith(imported: unknown[], managed: unknown[]): Env {
  return {
    DB: {
      prepare(sql: string) {
        const results = sql.includes("calendar_source") ? imported : managed;
        return { all: async () => ({ results }) };
      },
    },
  } as unknown as Env;
}

describe("listPublicCalendarFeeds", () => {
  const imported = [
    { id: "01SRC", name: "Hopkins District", color: "#123456", url: "https://example.org/secret-abc123.ics" },
  ];
  const managed = [{ id: "01MC", name: "PTO events", color: "#0068A8" }];

  it("never publishes an imported feed's upstream URL", async () => {
    const feeds = await listPublicCalendarFeeds(envWith(imported, managed), "https://api.example");
    const src = feeds.find((f) => f.id === "01SRC");
    expect(src?.url).toBeNull();
    // The whole point: the secret must not survive anywhere in the response.
    expect(JSON.stringify(feeds)).not.toContain("secret-abc123");
  });

  it("does publish a managed calendar's own /ics URL", async () => {
    const feeds = await listPublicCalendarFeeds(envWith(imported, managed), "https://api.example");
    expect(feeds.find((f) => f.id === "01MC")?.url).toBe("https://api.example/ics/01MC.ics");
  });

  it("still lists every calendar, so the filter chips stay complete", async () => {
    const feeds = await listPublicCalendarFeeds(envWith(imported, managed), "https://api.example");
    expect(feeds.map((f) => f.name)).toEqual(["Hopkins District", "PTO events"]);
    for (const f of feeds) expect(Object.keys(f).sort()).toEqual(["color", "id", "name", "url"]);
  });
});
