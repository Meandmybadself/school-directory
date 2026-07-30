// Route-level auth boundary.
//
// The unit tests in calendarPublic.test.ts prove the DTO narrowing is airtight;
// these prove the gating itself — that the public routes genuinely answer with
// no session, and that the member routes genuinely refuse. Those are the two
// facts a reader of `calendarPublic.ts` has to take on faith otherwise, since
// "is public" is expressed by the ABSENCE of a requireAuth call and absence is
// exactly what a diff is bad at showing.
//
// Routers are mounted into a bare Hono app carrying the same onError mapping as
// src/index.ts, because UnauthorizedError → 401 is defined there, not in the
// routers. No sessionMiddleware is installed: these requests carry no cookie, so
// c.var.auth would be unset either way, which is precisely the case under test.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { calendar } from "../src/routes/calendar.js";
import { calendarPublic } from "../src/routes/calendarPublic.js";
import type { HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";

/** D1 stand-in returning fixed rows for the two SELECT shapes these routes use. */
function testEnv(): HonoEnv["Bindings"] {
  const eventRow = {
    id: "01EVENT",
    title: "General Meeting",
    location: "Media Center",
    description: null,
    starts_at: "2099-09-10T18:00:00.000Z",
    ends_at: null,
    all_day: 0,
    managed_event_id: "01SERIES",
    source_id: "01MC",
    source_name: "PTO events",
    source_color: "#0068A8",
  };
  return {
    DB: {
      prepare(sql: string) {
        const results = sql.includes("FROM calendar_event")
          ? [eventRow]
          : sql.includes("calendar_source")
            ? [{ id: "01SRC", name: "District", color: "#123456", url: "https://upstream.example/secret.ics" }]
            : [{ id: "01MC", name: "PTO events", color: "#0068A8" }];
        return { bind: () => ({ all: async () => ({ results }) }), all: async () => ({ results }) };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function appWith(path: string, router: Hono<HonoEnv>): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.route(path, router);
  // Mirrors src/index.ts's onError — the only place UnauthorizedError becomes 401.
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

describe("public calendar routes answer without a session", () => {
  const app = appWith("/calendar-public", calendarPublic);

  it("GET /calendar-public/events → 200", async () => {
    const res = await app.request("/calendar-public/events", {}, testEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<Record<string, unknown>> };
    expect(body.events.length).toBeGreaterThan(0);
    // The narrowing is applied on the real response, not just in isolation.
    expect(body.events[0]).not.toHaveProperty("seriesId");
    expect(body.events[0]).not.toHaveProperty("recurrenceId");
  });

  it("GET /calendar-public/sources → 200, no upstream URL on the wire", async () => {
    const res = await app.request("/calendar-public/sources", {}, testEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("upstream.example");
  });
});

describe("the public newsletter archive narrows its frozen snapshot", () => {
  /** A sent issue whose stored snapshot still carries the full DTO — which is
   *  correct: the frozen artifact must keep matching the email. The narrowing is
   *  supposed to happen on the way out. */
  function newsletterEnv(): HonoEnv["Bindings"] {
    const snapshot = {
      block1: [
        {
          id: "01EVENT",
          kind: "managed",
          seriesId: "01SERIES",
          recurrenceId: "2099-09-10T18:00:00.000Z",
          title: "General Meeting",
          location: "Media Center",
          description: null,
          start: "2099-09-10T18:00:00.000Z",
          end: null,
          allDay: false,
          sourceIds: ["01MC"],
          source: { name: "PTO events", color: "#0068A8" },
        },
      ],
    };
    const issueRow = {
      slug: "2099-09-01-september",
      title: "September",
      subtitle: null,
      content_json: JSON.stringify({ type: "doc", content: [] }),
      events_snapshot_json: JSON.stringify(snapshot),
      sent_at: "2099-09-01T12:00:00.000Z",
    };
    return {
      SCHOOL_NAME: "Eisenhower PTO",
      DB: {
        prepare(sql: string) {
          const row = sql.includes("newsletter_issue") ? issueRow : null;
          return { bind: () => ({ first: async () => row, all: async () => ({ results: [] }) }) };
        },
      },
    } as unknown as HonoEnv["Bindings"];
  }

  it("strips seriesId/recurrenceId from the served snapshot", async () => {
    const { newsletterPublic } = await import("../src/routes/newsletterPublic.js");
    const app = appWith("/newsletter-public", newsletterPublic);
    const res = await app.request("/newsletter-public/issues/2099-09-01-september", {}, newsletterEnv());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      eventsSnapshot: Record<string, Array<Record<string, unknown>> | undefined>;
    };
    const block = body.eventsSnapshot.block1 ?? [];
    expect(block).toHaveLength(1);
    const event = block[0]!;
    expect(event).not.toHaveProperty("seriesId");
    expect(event).not.toHaveProperty("recurrenceId");
    // The reader-visible content still survives the narrowing.
    expect(event.title).toBe("General Meeting");
    expect(event.location).toBe("Media Center");
  });
});

describe("member calendar routes refuse without a session", () => {
  const app = appWith("/calendar", calendar);

  it("GET /calendar/events → 401", async () => {
    const res = await app.request("/calendar/events", {}, testEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("GET /calendar/sources → 401", async () => {
    const res = await app.request("/calendar/sources", {}, testEnv());
    expect(res.status).toBe(401);
  });
});
