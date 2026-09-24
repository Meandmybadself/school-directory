// GET /groups?kind=… — narrowing the groups index by type.
//
// Pinned for directoryFilter.test.ts's reasons, one route along. A filtered
// listing and an empty one look identical in a response, so the only place to
// assert that the term reached the statement at all — bound, not interpolated,
// and ANDed onto the name search rather than replacing it — is the SQL.
//
// The 400 is the case worth having a test for: dropping a kind nobody
// recognises would answer a filtered request with every group in the school
// while looking like it had been narrowed.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { GROUP_KINDS } from "@sd/shared";
import { groups } from "../src/routes/groups.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

const VIEWER: AuthContext = {
  userId: "01USER",
  realUserId: "01USER",
  email: "parent@eisenhower.edu",
  isSystemAdmin: false,
  sessionId: "01SESSION",
  activePersonId: "01ME",
  isMasquerading: false,
  isApproved: true,
};

interface Seen {
  sql: string;
  args: unknown[];
}

/** A fake D1 that HONOURS the statement's own kind term, so a filter that
 *  silently dropped it fails with a household on a classrooms-only request
 *  rather than passing a text scan. */
function testEnv(seen: Seen[]): HonoEnv["Bindings"] {
  const rows = [
    { id: "01H", kind: "household", name: "Ruiz", member_count: 4 },
    { id: "01C", kind: "classroom", name: "Grade 2 · Rm 322", member_count: 22 },
    { id: "01G", kind: "generic", name: "Book Fair Committee", member_count: 3 },
  ];
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      seen.push({ sql, args: this.args });
      // The kinds are whatever this statement bound after `q` and the LIKE.
      const asked = this.args.slice(2);
      const results = asked.length ? rows.filter((r) => asked.includes(r.kind)) : rows;
      return { results };
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
  a.route("/groups", groups);
  return a;
}

async function listing(url: string): Promise<{ status: number; seen: Seen[]; kinds: string[] }> {
  const seen: Seen[] = [];
  const res = await app().request(url, {}, testEnv(seen));
  const body = res.status === 200 ? ((await res.json()) as { groups: { kind: string }[] }) : { groups: [] };
  return { status: res.status, seen, kinds: body.groups.map((g) => g.kind) };
}

/** The one statement this route runs — the listing itself. */
function only(seen: Seen[]): Seen {
  expect(seen.length).toBe(1);
  const s = seen[0];
  if (!s) throw new Error("no statement ran");
  return s;
}

describe("GET /groups kind filter", () => {
  it("adds no kind term when none is asked for", async () => {
    const { status, seen, kinds } = await listing("/groups?q=ruiz");
    expect(status).toBe(200);
    expect(only(seen).sql).not.toContain("g.kind IN");
    expect(kinds).toEqual(["household", "classroom", "generic"]);
  });

  it("narrows the listing to one kind, keeping the name term", async () => {
    const { status, seen, kinds } = await listing("/groups?q=grade&kind=classroom");
    expect(status).toBe(200);
    expect(only(seen).sql).toContain("g.kind IN (?)");
    // ANDed onto the name search, never in place of it.
    expect(only(seen).sql).toContain("lower(g.name) LIKE ?");
    expect(only(seen).args).toEqual(["grade", "%grade%", "classroom"]);
    expect(kinds).toEqual(["classroom"]);
  });

  it("reads several kinds as OR, in one IN, deduped across both spellings", async () => {
    const { status, seen, kinds } = await listing(
      "/groups?kind=household,classroom&kind=household",
    );
    expect(status).toBe(200);
    expect(only(seen).sql).toContain("g.kind IN (?,?)");
    expect(only(seen).args.filter((a) => a === "household").length).toBe(1);
    expect(kinds).toEqual(["household", "classroom"]);
  });

  it("binds the kinds rather than interpolating them", async () => {
    const { seen } = await listing("/groups?kind=household&kind=generic");
    expect(only(seen).sql).not.toContain("household");
    expect(only(seen).sql).not.toContain("generic");
  });

  it("400s on a kind that isn't one, rather than serving every group", async () => {
    for (const url of [
      "/groups?kind=bogus",
      "/groups?kind=classroom,bogus",
      "/groups?kind=Household", // codes are exact; the client sends GROUP_KINDS
    ]) {
      const { status, seen } = await listing(url);
      expect(status).toBe(400);
      expect(seen.length).toBe(0); // refused before a single statement ran
    }
  });

  it("treats an empty value as no filter at all", async () => {
    const { status, seen } = await listing("/groups?kind=");
    expect(status).toBe(200);
    expect(only(seen).sql).not.toContain("g.kind IN");
  });

  it("accepts every kind the client can offer, so no chip can 400", async () => {
    const { status } = await listing(`/groups?${GROUP_KINDS.map((k) => `kind=${k}`).join("&")}`);
    expect(status).toBe(200);
  });
});
