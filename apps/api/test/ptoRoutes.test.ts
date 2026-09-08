// The PTO router's gating, at the route.
//
// test/ptoAccess.test.ts proves the gate FUNCTION decides correctly; this proves
// every route actually asks it. Those are different failures: the one this
// catches is a route added next year that forgets `requirePto` — the same shape
// of blindness `test/routeAuth.test.ts` was written for, and the reason that
// file exists beside the DTO tests rather than instead of them.
//
// The list below is enumerated by hand and deliberately covers a read, a
// create, a patch, a move, a delete, an assignee write and both pickers, so a
// method or a shape that gets its own handler is represented. If you add a
// route to routes/pto.ts, add it here — a route missing from this list is
// exactly what nothing else will notice.

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { pto } from "../src/routes/pto.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const GROUP = "01GRP";

/** D1 stand-in for the two statements the gate issues, and nothing else.
 *
 *  It answers `first()` only; every route under test is refused before it can
 *  reach a read of its own, which is the property being asserted. A route that
 *  slipped past the gate would throw "unhandled" here rather than quietly
 *  returning data — a loud failure, on purpose. */
function testEnv(onBoard: boolean): HonoEnv["Bindings"] {
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind: () => ({
            async first() {
              if (sql.includes("FROM setting")) return { value: GROUP };
              if (sql.includes("FROM grp")) return { id: GROUP, name: "PTO Board" };
              if (sql.includes("FROM membership m")) return onBoard ? { ok: 1 } : null;
              throw new Error(`testEnv: unhandled statement: ${sql}`);
            },
            async all() {
              throw new Error(`testEnv: a gated route reached a read: ${sql}`);
            },
            async run() {
              throw new Error(`testEnv: a gated route reached a write: ${sql}`);
            },
          }),
        };
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

function auth(userId: string, isSystemAdmin = false): AuthContext {
  return {
    userId,
    realUserId: userId,
    email: `${userId}@eisenhower.edu`,
    isSystemAdmin,
    sessionId: "01SESSION",
    activePersonId: null,
    isMasquerading: false,
  };
}

/** The router, with an optional session injected. `audit` is set because the
 *  real audit middleware does it and the routes push into it unconditionally. */
function appWith(session: AuthContext | null): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", async (c, next) => {
    c.set("audit", []);
    if (session) c.set("auth", session);
    await next();
  });
  app.route("/pto", pto);
  // Mirrors src/index.ts's onError — the only place UnauthorizedError becomes a
  // 401. Without it a missing session would surface as a 500 and this suite
  // would be asserting the wrong number.
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

/** Every route the gate has to cover: method, path, and a body where one is
 *  required. */
const ROUTES: Array<[string, string, unknown?]> = [
  ["GET", "/pto/boards"],
  ["POST", "/pto/boards", { title: "Read-A-Thon" }],
  ["GET", "/pto/boards/read-a-thon"],
  ["PATCH", "/pto/boards/01BOARD", { title: "x" }],
  ["GET", "/pto/boards/01BOARD/removal-impact"],
  ["DELETE", "/pto/boards/01BOARD"],
  ["POST", "/pto/boards/01BOARD/lists", { title: "To do" }],
  ["PATCH", "/pto/lists/01LIST", { title: "Doing" }],
  ["DELETE", "/pto/lists/01LIST"],
  ["POST", "/pto/boards/01BOARD/cards", { listId: "01LIST", title: "Book the buses" }],
  ["PATCH", "/pto/cards/01CARD", { title: "x" }],
  ["POST", "/pto/cards/01CARD/move", { listId: "01LIST" }],
  ["DELETE", "/pto/cards/01CARD"],
  ["PUT", "/pto/cards/01CARD/assignees", { personIds: ["01DANA"] }],
  ["GET", "/pto/cards/01CARD/comments"],
  ["POST", "/pto/cards/01CARD/comments", { body: "on it" }],
  ["DELETE", "/pto/comments/01COMMENT"],
  ["POST", "/pto/boards/01BOARD/labels", { name: "Money", color: "green" }],
  ["DELETE", "/pto/boards/01BOARD/labels/01LABEL"],
  ["GET", "/pto/roster"],
  ["GET", "/pto/events"],
];

function call(app: Hono<HonoEnv>, method: string, path: string, body: unknown, onBoard: boolean) {
  return app.request(
    path,
    {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    },
    testEnv(onBoard),
  );
}

describe("every /pto route refuses without a session", () => {
  const app = appWith(null);
  for (const [method, path, body] of ROUTES) {
    it(`${method} ${path} → 401`, async () => {
      expect((await call(app, method, path, body, true)).status).toBe(401);
    });
  }
});

describe("every /pto route refuses a member who is not on the PTO board", () => {
  const app = appWith(auth("01U_OUTSIDER"));
  for (const [method, path, body] of ROUTES) {
    it(`${method} ${path} → 403`, async () => {
      expect((await call(app, method, path, body, false)).status).toBe(403);
    });
  }
});

describe("GET /pto/access is the one route outside the gate", () => {
  it("answers a member who is not on the board, so the app can say so", async () => {
    const res = await appWith(auth("01U_OUTSIDER")).request("/pto/access", {}, testEnv(false));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { canUse: boolean; groupName: string | null };
    expect(body.canUse).toBe(false);
    // Named so the refusal card can say which roster it is. `GET /groups`
    // already serves every group's name to any member (invariant 21 records
    // that as an accepted cost), so this discloses nothing new.
    expect(body.groupName).toBe("PTO Board");
  });

  it("still needs a session", async () => {
    const res = await appWith(null).request("/pto/access", {}, testEnv(true));
    expect(res.status).toBe(401);
  });
});

describe("PUT /pto/settings is system-admin only", () => {
  it("refuses a board member who is not a system admin", async () => {
    const res = await appWith(auth("01U_DANA")).request(
      "/pto/settings",
      { method: "PUT", body: JSON.stringify({ groupId: GROUP }), headers: { "content-type": "application/json" } },
      testEnv(true),
    );
    expect(res.status).toBe(403);
  });

  it("refuses without a session", async () => {
    const res = await appWith(null).request(
      "/pto/settings",
      { method: "PUT", body: JSON.stringify({ groupId: GROUP }), headers: { "content-type": "application/json" } },
      testEnv(true),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /pto/groups is system-admin only", () => {
  it("refuses a board member who is not a system admin", async () => {
    const res = await appWith(auth("01U_DANA")).request("/pto/groups", {}, testEnv(true));
    expect(res.status).toBe(403);
  });
});
