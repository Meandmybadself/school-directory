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

  it("GET /calendar-public/events/:date/:slug → 200, still narrowed", async () => {
    // One event's own page. Ungated for the same reason the agenda is — the
    // link's whole job is to open from a text message — and narrowed by the same
    // projection, so the durable pair a volunteer signup keys on stays off it.
    const res = await app.request("/calendar-public/events/2099-09-10/general-meeting", {}, testEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: Record<string, unknown> };
    expect(body.event.title).toBe("General Meeting");
    expect(body.event).not.toHaveProperty("seriesId");
    expect(body.event).not.toHaveProperty("recurrenceId");
  });

  it("GET /calendar-public/events/:date/:slug → 404 for a title that isn't there", async () => {
    const res = await app.request("/calendar-public/events/2099-09-10/annual-gala", {}, testEnv());
    expect(res.status).toBe(404);
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

  it("GET /calendar/events/:date/:slug → 401", async () => {
    // The single-event twin of the agenda read. It exists only to hand an admin
    // `seriesId`, so it must refuse a stranger exactly as its sibling does.
    const res = await app.request("/calendar/events/2099-09-10/general-meeting", {}, testEnv());
    expect(res.status).toBe(401);
  });

  it("GET /calendar/sources → 401", async () => {
    const res = await app.request("/calendar/sources", {}, testEnv());
    expect(res.status).toBe(401);
  });
});

// ── Volunteer signups ───────────────────────────────────────────────────────
//
// Same two facts as the calendar pair above, for the sheet routes: the public
// one genuinely answers with no cookie, and the member one genuinely refuses.
// The extra thing proven here is that the anonymous 200 carries no NAMES — the
// narrowing tested in isolation by volunteersPublic.test.ts, asserted on a real
// response so a route that forgot to call `publicSheetOf` would be caught.

/** D1 stand-in for one published sheet with one filled position. */
function volunteerEnv(): HonoEnv["Bindings"] {
  const sheetRow = {
    id: "01SHEET",
    managed_event_id: "01SERIES",
    occurrence_start: "2099-10-17T22:00:00.000Z",
    slug: "fall-carnival-2099-10-17",
    intro: "Help us run the carnival.",
    published_at: "2099-09-01T12:00:00.000Z",
    closes_at: null,
    created_at: "2099-09-01T12:00:00.000Z",
    title: "Fall Carnival",
    location: "Gym",
    description: null,
    event_starts_at: "2099-10-17T22:00:00.000Z",
    event_ends_at: "2099-10-18T02:00:00.000Z",
    all_day: 0,
  };
  const positionRow = {
    id: "01POS", sheet_id: "01SHEET", title: "Snack table", description: null,
    slots: 4, starts_at: null, ends_at: null, sort_order: 0,
  };
  const signupRow = {
    id: "01SIGNUP", position_id: "01POS", person_id: "01PERSON",
    note: "I'll bring the cooler", created_at: "2099-09-02T12:00:00.000Z",
    first_name: "Dana", last_name: "Rivera", last_name_visibility: "full",
  };
  return {
    DB: {
      prepare(sql: string) {
        const results = sql.includes("FROM volunteer_position")
          ? [positionRow]
          : sql.includes("FROM volunteer_signup")
            ? [signupRow]
            : [];
        return {
          bind: () => ({
            first: async () => (sql.includes("FROM volunteer_sheet") ? sheetRow : null),
            all: async () => ({ results }),
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

describe("the public volunteer sheet answers without a session, and without names", () => {
  it("GET /volunteers-public/sheets/:slug → 200 carrying counts but no volunteer", async () => {
    const { volunteersPublic } = await import("../src/routes/volunteersPublic.js");
    const app = appWith("/volunteers-public", volunteersPublic);
    const res = await app.request(
      "/volunteers-public/sheets/fall-carnival-2099-10-17",
      {},
      volunteerEnv(),
    );
    expect(res.status).toBe(200);

    const text = await res.text();
    // The count is the whole public story about a position…
    expect(text).toContain('"filled":1');
    expect(text).toContain('"slots":4');
    // …and none of the person behind it may appear, in any field.
    expect(text).not.toContain("Dana");
    expect(text).not.toContain("Rivera");
    expect(text).not.toContain("01PERSON");
    expect(text).not.toContain("cooler");
    // Nor the durable handle that would address them (invariant 12).
    expect(text).not.toContain("01SERIES");
    expect(text).not.toContain("seriesId");
  });
});

describe("member volunteer routes refuse without a session", () => {
  it("GET /volunteers/sheets/:slug → 401", async () => {
    const { volunteers } = await import("../src/routes/volunteers.js");
    const app = appWith("/volunteers", volunteers);
    const res = await app.request("/volunteers/sheets/fall-carnival-2099-10-17", {}, volunteerEnv());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("POST /volunteers/positions/:id/signups → 401 (no anonymous claim path)", async () => {
    const { volunteers } = await import("../src/routes/volunteers.js");
    const app = appWith("/volunteers", volunteers);
    const res = await app.request(
      "/volunteers/positions/01POS/signups",
      { method: "POST", body: JSON.stringify({ personId: "01PERSON" }), headers: { "Content-Type": "application/json" } },
      volunteerEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /volunteers/signups/:id → 401", async () => {
    const { volunteers } = await import("../src/routes/volunteers.js");
    const app = appWith("/volunteers", volunteers);
    const res = await app.request("/volunteers/signups/01SIGNUP", { method: "DELETE" }, volunteerEnv());
    expect(res.status).toBe(401);
  });
});

describe("newsletter review-link routes refuse without a session", () => {
  // Minting one of these hands out a URL that reads an unsent issue, so the two
  // routes below are the mechanism's whole attack surface. They carry the file's
  // ordinary inline admin gate rather than a middleware, which is exactly the
  // kind of thing worth pinning: a dropped `requireAuth` line looks like nothing
  // in a diff.
  const newsletterEnv = () =>
    ({
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => ({ id: "01ISSUE" }), run: async () => ({}) }) }),
      },
    }) as unknown as HonoEnv["Bindings"];

  it("POST /newsletter/issues/:id/preview-link → 401", async () => {
    const { newsletter } = await import("../src/routes/newsletter.js");
    const app = appWith("/newsletter", newsletter);
    const res = await app.request(
      "/newsletter/issues/01ISSUE/preview-link",
      { method: "POST" },
      newsletterEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /newsletter/issues/:id/preview-link → 401", async () => {
    const { newsletter } = await import("../src/routes/newsletter.js");
    const app = appWith("/newsletter", newsletter);
    const res = await app.request(
      "/newsletter/issues/01ISSUE/preview-link",
      { method: "DELETE" },
      newsletterEnv(),
    );
    expect(res.status).toBe(401);
  });
});
