// An event's own URL — the content identity behind /e/:date/:slug.
//
// An event has no durable public id (invariant 8), and the durable handle a
// managed occurrence does have is deliberately withheld from public responses
// (invariant 12). So a link addresses an event by CONTENT — the day it falls on
// plus a slug of its title — and resolving one is a search, not a key lookup.
//
// These tests pin the two halves of that round trip to each other. The slug
// function is shared by the app (which mints links) and the API (which matches
// them), so a change to it that isn't symmetric silently breaks every link
// already in circulation; and the lookup's tolerances exist because the app
// mints the date in the READER'S timezone, which this Worker cannot know.

import { describe, expect, it } from "vitest";
import { eventDateSegment, eventPath, eventTitleSlug } from "@sd/shared";
import { findEventByPath, publicEventOf } from "../src/lib/calendar.js";
import type { Env } from "../src/env.js";

interface Row {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: number;
  source_id: string;
  source_name: string;
  source_color: string;
  managed_event_id: string | null;
  volunteer_slug: string | null;
}

function row(over: Partial<Row> & Pick<Row, "id" | "title" | "starts_at">): Row {
  return {
    location: null,
    description: null,
    ends_at: null,
    all_day: 0,
    source_id: "01SRC",
    source_name: "PTO events",
    source_color: "#0068A8",
    managed_event_id: null,
    volunteer_slug: null,
    ...over,
  };
}

/** D1 stand-in for `queryUpcomingEvents`'s single SELECT, applying the same
 *  window the real WHERE clause does so the test covers which rows the lookup
 *  even considers. Binds are [from, from, to, cap] — see the query. */
function envWith(rows: Row[], seen?: { binds: unknown[] }): Env {
  return {
    DB: {
      prepare() {
        return {
          bind(...binds: unknown[]) {
            if (seen) seen.binds = binds;
            const [from, , to] = binds as [string, string, string];
            const results = rows
              .filter((r) => (r.ends_at ?? r.starts_at) >= from && r.starts_at < to)
              .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
            return { all: async () => ({ results }) };
          },
        };
      },
    },
  } as unknown as Env;
}

describe("eventTitleSlug", () => {
  it("makes a readable slug out of an ordinary title", () => {
    expect(eventTitleSlug("Fall Carnival")).toBe("fall-carnival");
    expect(eventTitleSlug("General Meeting - Sept")).toBe("general-meeting-sept");
  });

  it("closes up apostrophes rather than splitting on them", () => {
    // "parents-night", not "parents--night" — both spellings of the apostrophe
    // have to land on the same slug, or a curly quote breaks every link.
    expect(eventTitleSlug("Parents' Night")).toBe("parents-night");
    expect(eventTitleSlug("Parents’ Night")).toBe("parents-night");
  });

  it("folds diacritics, so accented and unaccented spellings agree", () => {
    expect(eventTitleSlug("Día de campo")).toBe("dia-de-campo");
  });

  it("keeps letters in any script rather than collapsing them", () => {
    // The school writes some titles in the languages it serves. Restricting to
    // a-z would make every one of them the same slug.
    expect(eventTitleSlug("野餐")).toBe("野餐");
    expect(eventTitleSlug("Kulan waalid")).toBe("kulan-waalid");
  });

  it("falls back rather than emitting an empty path segment", () => {
    // The date half of the URL is what disambiguates these.
    expect(eventTitleSlug("!!!")).toBe("event");
    expect(eventTitleSlug("   ")).toBe("event");
  });

  it("caps length and never ends on a separator", () => {
    const slug = eventTitleSlug("A very long title about the thing that is happening on Saturday afternoon");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("eventDateSegment", () => {
  it("reads a timed event in the given zone, not UTC", () => {
    // 7pm Chicago on Oct 17 is Oct 18 in UTC. The link has to say the day the
    // reader saw on the agenda, or it reads as the wrong event.
    const e = { start: "2026-10-18T00:00:00.000Z", allDay: false };
    expect(eventDateSegment(e, "America/Chicago")).toBe("2026-10-17");
    expect(eventDateSegment(e, "UTC")).toBe("2026-10-18");
  });

  it("reads an all-day event in UTC regardless of zone", () => {
    // All-day values denote a DATE and are stored at UTC midnight; resolving one
    // in a western zone would slide it to the day before.
    const e = { start: "2026-10-17T00:00:00.000Z", allDay: true };
    expect(eventDateSegment(e, "America/Chicago")).toBe("2026-10-17");
    expect(eventDateSegment(e, "Asia/Tokyo")).toBe("2026-10-17");
  });
});

describe("findEventByPath", () => {
  const carnival = row({
    id: "01A",
    title: "Fall Carnival",
    starts_at: "2026-10-18T00:00:00.000Z", // 7pm Oct 17, Chicago
    ends_at: "2026-10-18T03:00:00.000Z",
    location: "Gym",
  });

  it("resolves the link the app minted, timezone skew and all", async () => {
    // The whole round trip: mint in the reader's zone, match on the server.
    const path = eventPath({ title: "Fall Carnival", start: carnival.starts_at, allDay: false }, "America/Chicago");
    expect(path).toBe("/e/2026-10-17/fall-carnival");

    const found = await findEventByPath(envWith([carnival]), "2026-10-17", "fall-carnival");
    expect(found?.id).toBe("01A");
    expect(found?.location).toBe("Gym");
  });

  it("resolves an IMPORTED event, which has no durable id at all", async () => {
    // The reason the URL is a content identity rather than a minted slug: an
    // event from someone else's ICS feed has nothing else to be addressed by.
    const found = await findEventByPath(envWith([carnival]), "2026-10-17", "fall-carnival");
    expect(found?.kind).toBe("imported");
    expect(found?.seriesId).toBeUndefined();
  });

  it("picks the occurrence nearest the requested day, not the first match", async () => {
    // A weekly series shares one title across many dates. Without the nearest
    // rule every one of its links would open the earliest occurrence.
    const weekly = ["2026-10-02", "2026-10-09", "2026-10-16"].map((d, i) =>
      row({
        id: `01W${i}`,
        title: "Chess Club",
        starts_at: `${d}T21:00:00.000Z`,
        ends_at: `${d}T22:00:00.000Z`,
        managed_event_id: "01SERIES",
        source_id: "01MC",
      }),
    );
    const found = await findEventByPath(envWith(weekly), "2026-10-09", "chess-club");
    expect(found?.id).toBe("01W1");
    // A managed occurrence resolves WITH its durable handle — this is the member
    // read; narrowing for anonymous callers is publicEventOf's job, below.
    expect(found?.seriesId).toBe("01SERIES");
    expect(found?.recurrenceId).toBe("2026-10-09T21:00:00.000Z");
  });

  it("searches a day either side, because the caller's zone is unknown", async () => {
    const seen = { binds: [] as unknown[] };
    await findEventByPath(envWith([carnival], seen), "2026-10-17", "fall-carnival");
    const [from, , to] = seen.binds as [string, string, string];
    expect(from).toBe("2026-10-16T00:00:00.000Z");
    expect(to).toBe("2026-10-19T00:00:00.000Z");
  });

  it("is null for a title that isn't there", async () => {
    expect(await findEventByPath(envWith([carnival]), "2026-10-17", "spring-carnival")).toBeNull();
  });

  it("is null for a date the event isn't on", async () => {
    // A week away is outside the ±1 day window, so a stale link 404s rather
    // than quietly opening a different week.
    expect(await findEventByPath(envWith([carnival]), "2026-10-24", "fall-carnival")).toBeNull();
  });

  it("rejects a malformed date without touching the database", async () => {
    const env = {
      DB: {
        prepare() {
          throw new Error("should not query");
        },
      },
    } as unknown as Env;
    expect(await findEventByPath(env, "not-a-date", "fall-carnival")).toBeNull();
    expect(await findEventByPath(env, "2026-13", "fall-carnival")).toBeNull();
  });

  it("hands the anonymous route something publicEventOf still narrows", async () => {
    // The lookup is shared by both routes and returns the FULL DTO on purpose;
    // the public route is what strips it. Asserting the pair here keeps the
    // shared lookup from being mistaken for a public-safe shape.
    const managed = row({
      id: "01M",
      title: "Fall Carnival",
      starts_at: carnival.starts_at,
      managed_event_id: "01SERIES",
      volunteer_slug: "fall-carnival-2026-10-17",
    });
    const found = await findEventByPath(envWith([managed]), "2026-10-17", "fall-carnival");
    expect(found?.seriesId).toBe("01SERIES");

    const pub = publicEventOf(found!);
    expect(pub).not.toHaveProperty("seriesId");
    expect(pub).not.toHaveProperty("recurrenceId");
    // The slug survives — it is what puts the signup sheet on the event page.
    expect(pub.volunteerSlug).toBe("fall-carnival-2026-10-17");
  });
});
