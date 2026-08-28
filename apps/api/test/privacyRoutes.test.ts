// The three routes that were carrying privacy rules with nothing checking them.
//
// `home.ts` and `contacts.ts` are the ONLY places geo_lat/geo_lng are read, and
// invariant 2 says coordinates never leave the server — so the assertion here is
// the same shape calendarPublic.test.ts makes about its DTO: not "the fields we
// expected are present" but "no field matching this pattern got out".
//
// `directory.ts` (with the two pickers built the same way) carried the opposite
// problem: the response withheld a surname the QUERY still matched on, so a
// member could confirm a hidden last name by typing it. That one is checked at
// the SQL, because it is a thing the WHERE must not do — and a response test
// can't see the difference between "no match" and "correctly filtered".

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { contacts } from "../src/routes/contacts.js";
import { directory } from "../src/routes/directory.js";
import { groups } from "../src/routes/groups.js";
import { home } from "../src/routes/home.js";
import { shares } from "../src/routes/shares.js";
import { personSearchSql } from "../src/lib/privacy.js";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const VIEWER: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "parent@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01ME",
  isMasquerading: false,
};

interface Seen {
  sql: string;
  args: unknown[];
}

/** Records every statement, so a test can assert on the SQL the route built. */
function testEnv(rows: (sql: string) => unknown[], seen: Seen[] = []): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      seen.push({ sql, args });
      return this;
    },
    async first() {
      seen.push({ sql, args: this.args });
      return (rows(sql)[0] as Record<string, unknown>) ?? null;
    },
    async all() {
      seen.push({ sql, args: this.args });
      return { results: rows(sql) };
    },
    async run() {
      return { meta: { changes: 1 } };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

function appWith(path: string, router: Hono<HonoEnv>, auth: AuthContext | null = VIEWER): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    if (auth) c.set("auth", auth);
    await next();
  }));
  app.route(path, router);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

// ── Invariant 2: coordinates never leave the server ────────────────────────

describe("GET /home/neighbors returns distances, never coordinates", () => {
  const NEIGHBOUR = {
    owner_id: "01NEIGHBOUR",
    geo_lat: 44.925,
    geo_lng: -93.395,
    first_name: "Dana",
    last_name: "Ruiz",
    last_name_visibility: "initial" as const,
    name: "Ruiz household",
  };

  const env = () =>
    testEnv((sql) => {
      if (sql.includes("JOIN grp g ON g.id = m.group_id")) return [{ id: "01HH" }];
      // The viewer's own origin, then the candidate rows.
      if (sql.includes("owner_kind = 'person' AND owner_id = ?")) {
        return [{ geo_lat: 44.92, geo_lng: -93.39 }];
      }
      if (sql.includes("JOIN person p ON p.id = ci.owner_id")) return [NEIGHBOUR];
      if (sql.includes("JOIN grp g ON g.id = ci.owner_id")) return [NEIGHBOUR];
      return [];
    });

  it("emits no lat, lng or geo field anywhere in the response", async () => {
    const res = await appWith("/home", home).request("/home/neighbors", {}, env());
    expect(res.status).toBe(200);
    const body = await res.text();
    // Over the raw JSON, so a coordinate nested anywhere still trips it.
    expect(body).not.toMatch(/lat|lng|geo|coord/i);
    // And not merely because the response was empty.
    expect(JSON.parse(body).neighbors.length).toBeGreaterThan(0);
  });

  it("reports a banded distance, not a computed one", async () => {
    const res = await appWith("/home", home).request("/home/neighbors", {}, env());
    const body = (await res.json()) as { neighbors: { approxDistance: string }[] };
    for (const n of body.neighbors) {
      // Quarter-mile bands only — an unrounded figure would locate a house.
      expect(n.approxDistance).toMatch(/^~\d+(\.(25|5|75))? mi$/);
    }
  });

  it("401s without a session", async () => {
    const res = await appWith("/home", home, null).request("/home/neighbors", {}, env());
    expect(res.status).toBe(401);
  });
});

describe("GET /contacts/:id/map", () => {
  const item = {
    owner_kind: "person",
    owner_id: "01SOMEONE",
    type: "address",
    geo_lat: 44.92,
    geo_lng: -93.39,
  };

  it("403s someone who doesn't control the address's owner", async () => {
    const env = testEnv((sql) => (sql.includes("FROM contact_item") ? [item] : []));
    const res = await appWith("/", contacts).request("/contacts/01C/map", {}, env);
    expect(res.status).toBe(403);
  });

  it("401s without a session — before it reads the row", async () => {
    const seen: Seen[] = [];
    const env = testEnv((sql) => (sql.includes("FROM contact_item") ? [item] : []), seen);
    const res = await appWith("/", contacts, null).request("/contacts/01C/map", {}, env);
    expect(res.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("404s an address that was never geocoded, rather than fetching a map of nowhere", async () => {
    const env = testEnv((sql) =>
      sql.includes("FROM contact_item") ? [{ ...item, geo_lat: null, geo_lng: null }] : [],
    );
    const res = await appWith("/", contacts).request("/contacts/01C/map", {}, env);
    expect(res.status).toBe(404);
  });
});

// ── The last-name search oracle ────────────────────────────────────────────

describe("personSearchSql", () => {
  it("matches everything when there's no query", () => {
    expect(personSearchSql("", "01USER")).toEqual({ sql: "1", binds: [] });
  });

  it("never matches a surname without also testing the display rule", () => {
    const { sql, binds } = personSearchSql("ruiz", "01USER");
    expect(sql).toContain("last_name_visibility = 'full'");
    // The surname term and the guard are ANDed, so one can't be satisfied alone.
    expect(sql).toMatch(/last_name.*LIKE \?\s*AND \(last_name_visibility/s);
    // …with the controller exemption the rest of the privacy layer grants.
    expect(sql).toContain("SELECT person_id FROM control WHERE user_id = ?");
    expect(binds).toEqual(["%ruiz%", "%ruiz%", "01USER"]);
  });

  it("leaves first names unconditional — no display rule applies to them", () => {
    expect(personSearchSql("dana", "01USER").sql).toMatch(/^\(lower\(first_name\) LIKE \?/);
  });
});

describe("every name search goes through the guard", () => {
  /** A surname LIKE that isn't immediately followed by the visibility test is
   *  the oracle, wherever it appears. */
  function assertGuarded(seen: Seen[]) {
    const searches = seen.filter((s) => s.sql.includes("last_name") && s.sql.includes("LIKE"));
    expect(searches.length).toBeGreaterThan(0);
    for (const s of searches) {
      expect(s.sql).toContain("last_name_visibility = 'full'");
      expect(s.args).toContain(VIEWER.userId);
    }
  }

  it("the directory listing — and its COUNT, which leaks the same bit", async () => {
    const seen: Seen[] = [];
    const env = testEnv(() => [], seen);
    const res = await appWith("/directory", directory).request("/directory?q=ruiz", {}, env);
    expect(res.status).toBe(200);
    const guarded = seen.filter((s) => s.sql.includes("last_name_visibility = 'full'"));
    // Both statements: the page AND the total.
    expect(guarded.some((s) => s.sql.includes("COUNT(*)"))).toBe(true);
    expect(guarded.some((s) => s.sql.includes("photo_object_key"))).toBe(true);
    assertGuarded(seen);
  });

  it("the share-target picker", async () => {
    const seen: Seen[] = [];
    const env = testEnv(() => [], seen);
    const res = await appWith("/shares", shares).request("/shares/targets?q=ruiz", {}, env);
    expect(res.status).toBe(200);
    assertGuarded(seen);
  });

  it("the group add-member picker", async () => {
    const seen: Seen[] = [];
    const env = testEnv((sql) => (sql.includes("FROM grp WHERE id") ? [{ ok: 1 }] : []), seen);
    // This route is admin-gated, so the caller has to clear that bar before the
    // search runs at all. Being an admin is not a licence to read a surname the
    // owner hid — group admin is authority over a roster, not over a name.
    const res = await appWith("/groups", groups, { ...VIEWER, isSystemAdmin: true }).request(
      "/groups/01G/candidates?q=ruiz",
      {},
      env,
    );
    expect(res.status).toBe(200);
    assertGuarded(seen);
  });
});
