// GET /directory?capability=… — narrowing the roster by role.
//
// Two things are worth pinning. The first is the SQL, for the reason
// privacyRoutes.test.ts gives about the surname guard: a filtered result and an
// empty one look identical in a response, so "the filter reached the COUNT too"
// can only be asserted on the statement. A total that ignored the filter would
// keep offering "Load more" past the end of a list the user can see.
//
// The second is that the filter is conjoined with the search predicate rather
// than replacing it. `personSearchSql` carries the enumeration gate (invariant
// 21), so a WHERE that swapped one for the other would list unlisted teachers.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { directory } from "../src/routes/directory.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

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

function testEnv(seen: Seen[]): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async first() {
      seen.push({ sql, args: this.args });
      return { n: 0 };
    },
    async all() {
      seen.push({ sql, args: this.args });
      return { results: [] };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

function app(): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use("*", createMiddleware<HonoEnv>(async (c, next) => {
    c.set("audit", []);
    c.set("auth", VIEWER);
    await next();
  }));
  a.route("/directory", directory);
  return a;
}

async function statements(url: string): Promise<{ status: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const res = await app().request(url, {}, testEnv(seen));
  return { status: res.status, seen };
}

/** The page and its COUNT — the two statements that must agree. */
function listingStatements(seen: Seen[]): Seen[] {
  const s = seen.filter((x) => x.sql.includes("COUNT(*)") || x.sql.includes("photo_object_key"));
  expect(s.length).toBe(2);
  return s;
}

describe("GET /directory capability filter", () => {
  it("adds no capability term when none is asked for", async () => {
    const { status, seen } = await statements("/directory?q=dana");
    expect(status).toBe(200);
    for (const s of listingStatements(seen)) {
      expect(s.sql).not.toContain("capability_grant");
    }
  });

  it("narrows the page AND the total, and keeps the search predicate", async () => {
    const { status, seen } = await statements("/directory?capability=teacher");
    expect(status).toBe(200);
    for (const s of listingStatements(seen)) {
      expect(s.sql).toContain("FROM capability_grant WHERE capability IN (?)");
      expect(s.args).toContain("teacher");
      // Conjoined with the gate, never in place of it (invariant 21).
      expect(s.sql).toContain("unlisted_at IS NULL");
      expect(s.sql).toContain(" AND id IN (SELECT person_id FROM capability_grant");
    }
  });

  it("reads several roles as OR, in one IN, deduped across both spellings", async () => {
    const { status, seen } = await statements(
      "/directory?capability=teacher,staff&capability=teacher&capability=parent",
    );
    expect(status).toBe(200);
    for (const s of listingStatements(seen)) {
      expect(s.sql).toContain("capability IN (?,?,?)");
      expect(s.args).toEqual(expect.arrayContaining(["teacher", "staff", "parent"]));
      expect(s.args.filter((a) => a === "teacher").length).toBe(1);
    }
  });

  it("binds the codes rather than interpolating them", async () => {
    const { seen } = await statements("/directory?capability=teacher&capability=staff");
    for (const s of listingStatements(seen)) {
      expect(s.sql).not.toContain("teacher");
      expect(s.sql).not.toContain("staff");
    }
  });

  it("400s on a code that isn't a capability, rather than serving a wider list", async () => {
    // Silently dropping it would answer a filtered request with the whole
    // roster — the one outcome a filter must never produce.
    for (const url of [
      "/directory?capability=bogus",
      "/directory?capability=teacher,bogus",
      "/directory?capability=system_admin", // a User role, not a Person capability
    ]) {
      const { status, seen } = await statements(url);
      expect(status).toBe(400);
      expect(seen.length).toBe(0); // refused before a single statement ran
    }
  });

  it("treats an empty value as no filter at all", async () => {
    const { status, seen } = await statements("/directory?capability=");
    expect(status).toBe(200);
    for (const s of listingStatements(seen)) {
      expect(s.sql).not.toContain("capability_grant");
    }
  });
});
