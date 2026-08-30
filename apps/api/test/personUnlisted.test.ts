// Taking a Person off the roster: the write, and the two reads that don't go
// through a WHERE.
//
// `personListable.test.ts` proves every statement over `person` answers the gate,
// and `privacyRoutes.test.ts` proves the listings compose it. What neither covers
// is behaviour that isn't a listing at all:
//
//   POST /persons/:id/unlisted — new, admin-only, idempotent, and the only way
//   the flag ever moves.
//
//   GET /persons/:id — a hidden Person must 404 rather than merely render thin.
//   A listing that hides someone while still serving their profile at a guessed
//   ULID is the oracle invariant 18 describes, one URL further along.
//
//   A volunteer sheet — the one place the row deliberately survives the query
//   and is dropped in memory instead, so `filled` keeps counting a signer whose
//   name is withheld. A count that shrank with the name would advertise a taken
//   shift as needing help.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { persons } from "../src/routes/persons.js";
import { buildProfile } from "../src/lib/serialize.js";
import { loadSheetForMember } from "../src/lib/volunteers.js";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const ADMIN: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01S",
  activePersonId: "01ADMINPERSON",
  isMasquerading: false,
};
const MEMBER: AuthContext = { ...ADMIN, userId: "01USER", isSystemAdmin: false, activePersonId: "01ME" };

interface Seen {
  sql: string;
  args: unknown[];
}

function testEnv(rows: (sql: string, args: unknown[]) => unknown[], seen: Seen[] = []): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      seen.push({ sql, args: this.args });
      return (rows(sql, this.args)[0] as Record<string, unknown>) ?? null;
    },
    async all() {
      seen.push({ sql, args: this.args });
      return { results: rows(sql, this.args) };
    },
    async run() {
      seen.push({ sql, args: this.args });
      return { meta: { changes: 1 } };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

function appWith(auth: AuthContext | null, env: HonoEnv["Bindings"]) {
  const app = new Hono<HonoEnv>();
  const audit: unknown[] = [];
  app.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", audit as never);
    if (auth) c.set("auth", auth);
    await next();
  }));
  app.route("/persons", persons);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return { app, audit, env };
}

const LISTED = { id: "01P", unlisted_at: null };
const UNLISTED = { id: "01P", unlisted_at: "2026-01-01T00:00:00.000Z" };

describe("POST /persons/:id/unlisted", () => {
  it("refuses an ordinary member, however many Persons they control", async () => {
    const seen: Seen[] = [];
    const { app, env } = appWith(MEMBER, testEnv(() => [LISTED], seen));
    const res = await app.request(
      "/persons/01P/unlisted",
      { method: "POST", body: JSON.stringify({ unlisted: true }) },
      env,
    );
    expect(res.status).toBe(403);
    // Refused before it reads anything — the gate is the first line of the route.
    expect(seen).toEqual([]);
  });

  it("takes a listed Person off the roster and audits it", async () => {
    const seen: Seen[] = [];
    const { app, audit, env } = appWith(ADMIN, testEnv(() => [LISTED], seen));
    const res = await app.request(
      "/persons/01P/unlisted",
      { method: "POST", body: JSON.stringify({ unlisted: true }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, unlisted: true });
    const update = seen.find((s) => s.sql.includes("UPDATE person SET unlisted_at"));
    expect(update).toBeTruthy();
    expect(update!.args[0]).toEqual(expect.any(String)); // a timestamp, not a 1
    expect(audit).toEqual([
      expect.objectContaining({ entityKind: "person", entityId: "01P", detail: { op: "person.unlisted" } }),
    ]);
  });

  it("restores one by writing null, not by deleting anything", async () => {
    const seen: Seen[] = [];
    const { app, audit, env } = appWith(ADMIN, testEnv(() => [UNLISTED], seen));
    const res = await app.request(
      "/persons/01P/unlisted",
      { method: "POST", body: JSON.stringify({ unlisted: false }) },
      env,
    );
    expect(res.status).toBe(200);
    const update = seen.find((s) => s.sql.includes("UPDATE person SET unlisted_at"));
    expect(update!.args[0]).toBeNull();
    expect(audit).toEqual([expect.objectContaining({ detail: { op: "person.relisted" } })]);
  });

  it("is idempotent — setting what is already set writes nothing", async () => {
    const seen: Seen[] = [];
    const { app, audit, env } = appWith(ADMIN, testEnv(() => [UNLISTED], seen));
    const res = await app.request(
      "/persons/01P/unlisted",
      { method: "POST", body: JSON.stringify({ unlisted: true }) },
      env,
    );
    expect(res.status).toBe(200);
    expect(seen.some((s) => s.sql.includes("UPDATE"))).toBe(false);
    // Nor does a no-op earn an audit entry: nothing happened to record.
    expect(audit).toEqual([]);
  });

  it("404s a Person that isn't there", async () => {
    const { app, env } = appWith(ADMIN, testEnv(() => []));
    const res = await app.request(
      "/persons/01NOPE/unlisted",
      { method: "POST", body: JSON.stringify({ unlisted: true }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("rejects a body that doesn't say which way", async () => {
    const { app, env } = appWith(ADMIN, testEnv(() => [LISTED]));
    const res = await app.request("/persons/01P/unlisted", { method: "POST", body: "{}" }, env);
    expect(res.status).toBe(400);
  });
});

describe("buildProfile refuses to serve an unlisted Person", () => {
  /** Rows for a profile read, with the gate honoured the way D1 would. */
  function profileEnv(seen: Seen[], unlisted: boolean, viewerControls: boolean) {
    return testEnv((sql, args) => {
      if (sql.includes("FROM person WHERE id = ?")) {
        // The route's own WHERE decides this; emulate it rather than assume it.
        const gated = sql.includes("unlisted_at IS NULL");
        if (unlisted && gated && !viewerControls) return [];
        return [{
          id: "01P",
          first_name: "Test",
          last_name: "Family",
          last_name_visibility: "full",
          photo_object_key: null,
          unlisted_at: unlisted ? "2026-01-01T00:00:00.000Z" : null,
        }];
      }
      if (sql.includes("FROM control WHERE person_id")) {
        return viewerControls ? [{ user_id: "01USER" }] : [];
      }
      void args;
      return [];
    }, seen);
  }

  it("404s for an ordinary member who guessed the id", async () => {
    const seen: Seen[] = [];
    const env = profileEnv(seen, true, false);
    const profile = await buildProfile(env, { userId: "01USER", personId: "01ME" }, "01P", {});
    expect(profile).toBeNull();
    // And the gate was in the WHERE, not applied after the row came back.
    expect(seen[0]!.sql).toContain("unlisted_at IS NULL");
  });

  it("serves it to a Controller, and says so", async () => {
    const seen: Seen[] = [];
    const env = profileEnv(seen, true, true);
    const profile = await buildProfile(env, { userId: "01USER", personId: "01ME" }, "01P", {});
    expect(profile).not.toBeNull();
    expect(profile!.unlisted).toBe(true);
  });

  it("serves it to a system admin, who builds no predicate at all", async () => {
    const seen: Seen[] = [];
    const env = profileEnv(seen, true, false);
    const profile = await buildProfile(
      env,
      { userId: "01ADMIN", personId: "01ADMINPERSON" },
      "01P",
      { isSystemAdmin: true },
    );
    expect(profile).not.toBeNull();
    expect(profile!.unlisted).toBe(true);
    expect(seen[0]!.sql).not.toContain("unlisted_at IS NULL");
  });

  it("leaves `unlisted` off a listed Person entirely", async () => {
    const env = profileEnv([], false, true);
    const profile = await buildProfile(env, { userId: "01USER", personId: "01ME" }, "01P", {});
    expect(profile!.unlisted).toBeUndefined();
  });
});

describe("a volunteer sheet withholds an unlisted name without losing the count", () => {
  const SHEET_ROW = {
    id: "01SHEET",
    managed_event_id: "01SERIES",
    occurrence_start: "2026-10-17T22:00:00.000Z",
    slug: "fall-carnival-2026-10-17",
    intro: null,
    published_at: "2026-10-01T00:00:00.000Z",
    closes_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    title: "Fall Carnival",
    location: "Gym",
    description: null,
    event_starts_at: "2026-10-17T22:00:00.000Z",
    event_ends_at: "2026-10-18T02:00:00.000Z",
    all_day: 0,
  };
  const POSITION = {
    id: "01POS",
    sheet_id: "01SHEET",
    title: "Snack table",
    description: null,
    slots: 4,
    starts_at: null,
    ends_at: null,
    sort_order: 0,
  };
  const signup = (id: string, personId: string, first: string, unlistedAt: string | null) => ({
    id,
    position_id: "01POS",
    person_id: personId,
    note: null,
    created_at: "2026-10-02T00:00:00.000Z",
    first_name: first,
    last_name: "Ruiz",
    last_name_visibility: "full",
    unlisted_at: unlistedAt,
  });

  function sheetEnv() {
    return testEnv((sql) => {
      if (sql.includes("FROM volunteer_sheet s")) return [SHEET_ROW];
      if (sql.includes("FROM volunteer_position")) return [POSITION];
      if (sql.includes("FROM volunteer_signup su")) {
        return [
          signup("01A", "01LISTED", "Dana", null),
          signup("01B", "01HIDDEN", "Testy", "2026-01-01T00:00:00.000Z"),
        ];
      }
      return [];
    });
  }

  it("drops the hidden volunteer's name but still counts their spot", async () => {
    const result = await loadSheetForMember(sheetEnv(), "fall-carnival-2026-10-17", {
      userId: "01USER",
      isSystemAdmin: false,
      controlledPersonIds: new Set<string>(),
    });
    const position = result!.positions[0]!;
    // Two people are standing in this position; a member may see one of them.
    expect(position.filled).toBe(2);
    expect(position.signups.map((s) => s.displayName)).toEqual(["Dana Ruiz"]);
    // Nothing about the hidden signer survives anywhere in the response.
    expect(JSON.stringify(result)).not.toContain("01HIDDEN");
    expect(JSON.stringify(result)).not.toContain("Testy");
  });

  it("shows both to a system admin", async () => {
    const result = await loadSheetForMember(sheetEnv(), "fall-carnival-2026-10-17", {
      userId: "01ADMIN",
      isSystemAdmin: true,
      controlledPersonIds: new Set<string>(),
    });
    expect(result!.positions[0]!.signups).toHaveLength(2);
  });

  it("shows a Controller the Person they manage", async () => {
    const result = await loadSheetForMember(sheetEnv(), "fall-carnival-2026-10-17", {
      userId: "01USER",
      isSystemAdmin: false,
      controlledPersonIds: new Set(["01HIDDEN"]),
    });
    expect(result!.positions[0]!.signups).toHaveLength(2);
  });
});
