// POST /me/persons — the one endpoint that creates a directory Person.
//
// Two facts worth pinning, both newly load-bearing now that the welcome wizard
// calls this route on a member's behalf for every child and partner they add:
//
//   Capabilities are filtered to the ASSIGNABLE set. `household_admin` is
//   earned by being the admin member of a household (POST /groups grants it on
//   creation) and must not be grantable by asserting it on a Person you just
//   invented. Nothing authorizes on it today — it renders as a badge — so this
//   guards a labelling lie rather than a privilege hole, but the client has
//   only ever offered the other four and the server should agree.
//
//   Creating a Person and gaining control of it is ONE batch. A caller who ends
//   up with a person they cannot edit, or a control row pointing at nothing,
//   would be a genuinely stuck state with no UI to escape it.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { ASSIGNABLE_CAPABILITIES } from "@sd/shared";
import { me } from "../src/routes/me.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

interface Captured {
  sql: string;
  args: unknown[];
}

/** D1 stand-in that records every statement handed to `batch()`. */
function testEnv(captured: Captured[]): HonoEnv["Bindings"] {
  const stmt = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    // The route reads a control count to decide whether this is the user's
    // first Person; zero keeps that branch deterministic.
    async first() {
      return sql.includes("COUNT(*)") ? { n: 1 } : null;
    },
  });
  return {
    DB: {
      prepare: (sql: string) => stmt(sql),
      async batch(stmts: Captured[]) {
        captured.push(...stmts.map((s) => ({ sql: s.sql, args: s.args })));
        return [];
      },
    },
  } as unknown as HonoEnv["Bindings"];
}

const AUTH: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "dana@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01SELF",
  isMasquerading: false,
};

function appWith(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  // Stand in for contextMiddleware + sessionMiddleware: the audit buffer the
  // route pushes into, and an already-authenticated caller.
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", []);
      c.set("auth", AUTH);
      await next();
    }),
  );
  app.route("/me", me);
  return app;
}

async function createPerson(body: unknown): Promise<{ status: number; captured: Captured[] }> {
  const captured: Captured[] = [];
  const res = await appWith().request(
    "/me/persons",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
    testEnv(captured),
  );
  return { status: res.status, captured };
}

const grants = (captured: Captured[]) =>
  captured.filter((c) => c.sql.includes("INSERT INTO capability_grant")).map((c) => c.args[1]);

describe("POST /me/persons capability whitelist", () => {
  it("keeps the capabilities a member is allowed to assign", async () => {
    const { status, captured } = await createPerson({
      firstName: "Charlie",
      capabilities: ["student"],
    });
    expect(status).toBe(201);
    expect(grants(captured)).toEqual(["student"]);
  });

  it("refuses to grant household_admin, however it is asked for", async () => {
    // That role comes from administering a real household, not from claiming it
    // on a Person you created a moment ago.
    const { status, captured } = await createPerson({
      firstName: "Impostor",
      capabilities: ["household_admin"],
    });
    expect(status).toBe(201);
    expect(grants(captured)).toEqual([]);
    expect(ASSIGNABLE_CAPABILITIES).not.toContain("household_admin");
  });

  it("keeps the assignable ones while dropping the rest", async () => {
    const { captured } = await createPerson({
      firstName: "Marcus",
      capabilities: ["parent", "household_admin", "not_a_capability"],
    });
    expect(grants(captured)).toEqual(["parent"]);
  });
});

describe("POST /me/persons writes", () => {
  it("creates the Person and the caller's control of it in one batch", async () => {
    const { captured } = await createPerson({ firstName: "Charlie", lastName: "Ruiz" });
    const tables = captured.map((c) => c.sql.match(/INSERT INTO (\w+)/)?.[1]);
    expect(tables).toContain("person");
    expect(tables).toContain("control");
    // Same batch — a Person nobody controls has no route back into the UI.
    const control = captured.find((c) => c.sql.includes("INSERT INTO control"));
    expect(control?.args[0]).toBe("01USER");
  });

  it("rejects a blank name rather than creating an unnamed Person", async () => {
    const { status, captured } = await createPerson({ firstName: "   " });
    expect(status).toBe(400);
    expect(captured).toEqual([]);
  });
});
