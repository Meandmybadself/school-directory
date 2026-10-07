// "Add to calendar" for a volunteer spot.
//
// Three things are pinned here. WHEN the entry says the shift is — one rule
// (`volunteerShiftWindow`) shared by the Google link the browser builds and the
// `.ics` the API renders, so the two can't disagree. WHAT the file carries —
// the shift, the place and a link back to the event page, and nobody's name,
// though it is built from the member sheet that holds every volunteer's. And
// WHO may download it — the same authority that may give the spot back.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  googleCalendarUrl,
  volunteerEntryDetails,
  volunteerShiftWindow,
  type VolunteerSheetDTO,
} from "@sd/shared";
import type { AuthContext, HonoEnv } from "../src/env.js";

const mocks = vi.hoisted(() => ({
  signupOwner: vi.fn(),
  signupIcs: vi.fn(),
  viewerOf: vi.fn(),
  isController: vi.fn(),
}));
vi.mock("../src/lib/volunteers.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/volunteers.js")>()),
  signupOwner: mocks.signupOwner,
  signupIcs: mocks.signupIcs,
  viewerOf: mocks.viewerOf,
}));
vi.mock("../src/lib/privacy.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/privacy.js")>()),
  isController: mocks.isController,
}));

const { signupIcsOf } = await import("../src/lib/volunteers.js");
const { volunteers } = await import("../src/routes/volunteers.js");

const EVENT = {
  start: "2026-10-17T22:00:00.000Z", // 5:00 PM CDT
  end: "2026-10-18T02:00:00.000Z", // 9:00 PM CDT
  allDay: false,
};

describe("volunteerShiftWindow", () => {
  it("uses the position's own shift when it has one", () => {
    expect(
      volunteerShiftWindow(EVENT, { startsAt: "2026-10-17T21:00:00.000Z", endsAt: "2026-10-17T22:30:00.000Z" }),
    ).toEqual({ start: "2026-10-17T21:00:00.000Z", end: "2026-10-17T22:30:00.000Z", allDay: false });
  });

  it("falls back to the whole event", () => {
    expect(volunteerShiftWindow(EVENT, { startsAt: null, endsAt: null })).toEqual({ ...EVENT });
  });

  it("completes a half-open shift from the event", () => {
    expect(volunteerShiftWindow(EVENT, { startsAt: "2026-10-18T00:00:00.000Z", endsAt: null })).toMatchObject({
      start: "2026-10-18T00:00:00.000Z",
      end: EVENT.end,
    });
    expect(volunteerShiftWindow(EVENT, { startsAt: null, endsAt: "2026-10-17T23:00:00.000Z" })).toMatchObject({
      start: EVENT.start,
      end: "2026-10-17T23:00:00.000Z",
    });
  });

  it("gives an event with no end an hour", () => {
    expect(volunteerShiftWindow({ ...EVENT, end: null }, { startsAt: null, endsAt: null }).end).toBe(
      "2026-10-17T23:00:00.000Z",
    );
  });

  it("keeps an all-day event all-day, with an exclusive end date", () => {
    const day = { start: "2026-10-17T00:00:00.000Z", end: null, allDay: true };
    expect(volunteerShiftWindow(day, { startsAt: null, endsAt: null })).toEqual({
      start: "2026-10-17T00:00:00.000Z",
      end: "2026-10-18T00:00:00.000Z",
      allDay: true,
    });
  });

  it("makes a shift on an all-day event a timed entry, never one starting at UTC midnight", () => {
    const day = { start: "2026-10-17T00:00:00.000Z", end: null, allDay: true };
    expect(volunteerShiftWindow(day, { startsAt: null, endsAt: "2026-10-17T14:00:00.000Z" })).toEqual({
      start: "2026-10-17T13:00:00.000Z",
      end: "2026-10-17T14:00:00.000Z",
      allDay: false,
    });
  });
});

describe("googleCalendarUrl", () => {
  it("encodes the window in Google's compact form", () => {
    const url = new URL(
      googleCalendarUrl({
        title: "Volunteer: Setup — Fall Carnival",
        window: { start: EVENT.start, end: EVENT.end, allDay: false },
        location: "Gym; back door",
        details: volunteerEntryDetails("Bring gloves", "https://calendar.example/e/2026-10-17/fall-carnival"),
      }),
    );
    expect(url.host).toBe("calendar.google.com");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261017T220000Z/20261018T020000Z");
    expect(url.searchParams.get("location")).toBe("Gym; back door");
    expect(url.searchParams.get("details")).toBe(
      "Bring gloves\n\nhttps://calendar.example/e/2026-10-17/fall-carnival",
    );
  });

  it("uses bare dates for an all-day entry", () => {
    const url = new URL(
      googleCalendarUrl({
        title: "x",
        window: { start: "2026-10-17T00:00:00.000Z", end: "2026-10-18T00:00:00.000Z", allDay: true },
        location: null,
        details: "",
      }),
    );
    expect(url.searchParams.get("dates")).toBe("20261017/20261018");
    expect(url.searchParams.has("location")).toBe(false);
  });
});

const SHEET: VolunteerSheetDTO = {
  id: "01SHEET",
  slug: "fall-carnival-x1",
  intro: null,
  closesAt: null,
  closed: false,
  published: true,
  event: {
    seriesId: "01SERIES",
    recurrenceId: EVENT.start,
    title: "Fall Carnival",
    location: "Gym",
    description: "<p>Games and food</p>",
    ...EVENT,
  },
  positions: [
    {
      id: "01POS",
      title: "Setup crew",
      description: "Bring gloves",
      slots: 4,
      filled: 2,
      startsAt: "2026-10-17T21:00:00.000Z",
      endsAt: "2026-10-17T22:30:00.000Z",
      signups: [
        { id: "01SU", personId: "01DANA", displayName: "Dana Ruiz", note: "Bringing a ladder", isYou: true, createdAt: "" },
        { id: "01SU2", personId: "01SAM", displayName: "Sam Okonkwo", note: null, isYou: false, createdAt: "" },
      ],
    },
  ],
  canManage: false,
};

const OPTS = {
  calendarUrl: "https://calendar.eisenhower.school/",
  timeZone: "America/Chicago",
  locale: "es" as const,
  now: "2026-10-06T12:00:00.000Z",
};

describe("signupIcsOf", () => {
  it("renders the shift, the place and a link back to the event page", () => {
    const file = signupIcsOf(SHEET, "01POS", "01SU", OPTS)!;
    const body = file.body.replace(/\r\n /g, ""); // unfold
    expect(body).toContain("UID:volunteer-01SU@eisenhower.school");
    expect(body).toContain("DTSTART:20261017T210000Z");
    expect(body).toContain("DTEND:20261017T223000Z");
    expect(body).toContain("SUMMARY:Voluntariado: Setup crew — Fall Carnival");
    expect(body).toContain("LOCATION:Gym");
    expect(body).toContain("URL:https://calendar.eisenhower.school/e/2026-10-17/fall-carnival");
    expect(file.filename).toBe("volunteer-2026-10-17.ics");
  });

  it("names nobody, though the member sheet it reads names everyone", () => {
    const body = signupIcsOf(SHEET, "01POS", "01SU", OPTS)!.body;
    for (const leak of ["Dana", "Ruiz", "Sam", "Okonkwo", "ladder", "01DANA", "01SAM"]) {
      expect(body).not.toContain(leak);
    }
  });

  it("is null for a position no longer on the sheet", () => {
    expect(signupIcsOf(SHEET, "01GONE", "01SU", OPTS)).toBeNull();
  });
});

describe("GET /volunteers/signups/:id/ics", () => {
  const MEMBER: AuthContext = {
    userId: "01USER",
    realUserId: "01USER",
    email: "dana@eisenhower.edu",
    isSystemAdmin: false,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
    isApproved: true,
  };

  function app(): Hono<HonoEnv> {
    const a = new Hono<HonoEnv>();
    a.use(
      "*",
      createMiddleware<HonoEnv>(async (c, next) => {
        c.set("audit", []);
        c.set("auth", MEMBER);
        await next();
      }),
    );
    a.route("/volunteers", volunteers);
    return a;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signupOwner.mockResolvedValue({ personId: "01DANA", userId: "01USER", slug: "s", positionId: "01POS" });
    mocks.viewerOf.mockResolvedValue({ isSystemAdmin: false, controlledPersonIds: new Set(["01DANA"]) });
    mocks.signupIcs.mockResolvedValue({ body: "BEGIN:VCALENDAR\r\n", filename: "volunteer-2026-10-17.ics" });
  });

  it("serves a controller the file, uncached, in the requested language", async () => {
    mocks.isController.mockResolvedValue(true);
    const res = await app().request("/volunteers/signups/01SU/ics?lang=zh");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="volunteer-2026-10-17.ics"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.signupIcs.mock.calls[0]![3]).toBe("zh");
  });

  it("refuses a member who does not control the signed-up Person", async () => {
    mocks.isController.mockResolvedValue(false);
    const res = await app().request("/volunteers/signups/01SU/ics");
    expect(res.status).toBe(403);
    expect(mocks.signupIcs).not.toHaveBeenCalled();
  });

  it("404s a signup that no longer exists", async () => {
    mocks.signupOwner.mockResolvedValue(null);
    const res = await app().request("/volunteers/signups/01SU/ics");
    expect(res.status).toBe(404);
  });
});
