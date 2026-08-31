// A claimed spot is recorded even if building the response then fails.
//
// This pins an ordering that is easy to lose and expensive to lose quietly.
// `POST /positions/:id/signups` commits the claim, then reloads the sheet to
// answer with — and the reload is a second D1 round trip that can fail on its
// own. If the audit draft is pushed AFTER that reload (which reads naturally,
// since the reload is also where the notification gets the position's name),
// then a transient failure there leaves a real signup in the table with no
// audit row and no notification: a state change with no trace, which is the
// one thing invariant 5 exists to prevent.
//
// It is not caught by the obvious reasoning, either. "A throwing handler skips
// the flush anyway, so it makes no difference" is wrong: Hono's `compose`
// wraps each handler in its own try/catch and, with `onError` configured,
// turns the throw into a response AT THAT FRAME. `auditMiddleware`'s
// `await next()` therefore resolves normally and flushes whatever was already
// pushed. Pushing early genuinely saves the record; pushing late genuinely
// loses it.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditDraft } from "../src/lib/audit.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

// `vi.hoisted` because `vi.mock` is itself hoisted above these declarations —
// referencing plain consts in the factory would hit their temporal dead zone.
const mocks = vi.hoisted(() => ({
  claimSpot: vi.fn(),
  releaseSpot: vi.fn(),
  signupOwner: vi.fn(),
  loadSheetForMember: vi.fn(),
  viewerOf: vi.fn(),
}));
vi.mock("../src/lib/volunteers.js", () => mocks);

const { claimSpot, releaseSpot, signupOwner, loadSheetForMember, viewerOf } = mocks;
const { volunteers } = await import("../src/routes/volunteers.js");

const AUTH: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: null,
  isMasquerading: false,
};

const SHEET = {
  slug: "fall-festival",
  event: { title: "Fall Festival" },
  positions: [{ id: "01POS", title: "Setup Crew", filled: 2, slots: 4 }],
};

/** The live buffer, as auditMiddleware would see it after the handler runs. */
let audit: AuditDraft[] = [];

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      audit = [];
      c.set("audit", audit);
      c.set("auth", AUTH);
      c.set("ip", null);
      c.set("userAgent", null);
      await next();
    }),
  );
  a.route("/volunteers", volunteers);
  // Mirrors apps/api/src/index.ts — its presence is exactly what makes a
  // handler throw resolve rather than reject at the middleware above.
  a.onError(() => new Response("internal", { status: 500 }));
  return a;
}

const claim = (body: unknown) =>
  app().request("/volunteers/positions/01POS/signups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  viewerOf.mockResolvedValue({ isSystemAdmin: true, controlledPersonIds: new Set<string>() });
  claimSpot.mockResolvedValue({ ok: true, slug: "fall-festival" });
  loadSheetForMember.mockResolvedValue(SHEET);
  signupOwner.mockResolvedValue({
    personId: "01DANA",
    userId: "01ADMIN",
    slug: "fall-festival",
    positionId: "01POS",
  });
  releaseSpot.mockResolvedValue(undefined);
});

describe("a committed signup is always audited", () => {
  it("records the claim and enriches it when the reload succeeds", async () => {
    const res = await claim({ personId: "01DANA" });
    expect(res.status).toBe(201);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("volunteer.signup.created");
    // The response's own read is what names the spot, so no extra query.
    expect(audit[0]!.notify).toMatchObject({
      personId: "01DANA",
      sheetSlug: "fall-festival",
      positionTitle: "Setup Crew",
      eventTitle: "Fall Festival",
      filled: 2,
      slots: 4,
    });
  });

  it("still records the claim when the reload throws", async () => {
    loadSheetForMember.mockRejectedValue(new Error("D1_ERROR"));
    const res = await claim({ personId: "01DANA" });

    expect(res.status).toBe(500);
    // The spot really was claimed, so the log must say so. Pushing the draft
    // after the reload would make this an empty array.
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("volunteer.signup.created");
    expect(audit[0]!.detail).toEqual({ personId: "01DANA" });
    // The enrichment is simply absent — a message that can't name the position
    // is a smaller loss than no record at all.
    expect(audit[0]!.notify).toEqual({ personId: "01DANA", sheetSlug: "fall-festival" });
    expect(audit[0]!.notify).not.toHaveProperty("positionTitle");
  });

  it("records nothing when the claim itself did not happen", async () => {
    claimSpot.mockResolvedValue({ ok: false, reason: "full", slug: "fall-festival" });
    const res = await claim({ personId: "01DANA" });
    expect(res.status).toBe(409);
    expect(audit).toEqual([]);
  });

  it("still records a release when its reload throws", async () => {
    loadSheetForMember.mockRejectedValue(new Error("D1_ERROR"));
    const res = await app().request("/volunteers/signups/01SIGNUP", { method: "DELETE" });

    expect(res.status).toBe(500);
    expect(releaseSpot).toHaveBeenCalled();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("volunteer.signup.deleted");
    expect(audit[0]!.notify).toEqual({ personId: "01DANA", sheetSlug: "fall-festival" });
  });
});
