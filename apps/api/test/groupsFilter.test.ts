// GET /groups?q=&kind=… — searching and narrowing the groups index.
//
// Pinned for directoryFilter.test.ts's reasons, one route along. A filtered
// listing and an empty one look identical in a response, so the only places to
// assert anything are the SQL (the kind term: bound, not interpolated) and the
// rows that come back (the name term, which is applied in memory so it can
// match `groupLabel`'s elision — the whole reason the screen's own label,
// "Gr 2 - Shrestha", has to find the room whose stored name is the district's
// four-segment string).
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

interface Row {
  id: string;
  kind: string;
  name: string;
  member_count: number;
}

const ROWS: Row[] = [
  // The production shape this search kept missing: the row RENDERS as
  // "Gr 2 - Shrestha", and an accented household name folds to a plain-ASCII
  // keyboard's spelling.
  { id: "01C", kind: "classroom", name: "Grade 2 · Juntos · Pam Shrestha · Rm 322", member_count: 22 },
  { id: "01H", kind: "household", name: "Familia Rentería", member_count: 4 },
  { id: "01G", kind: "generic", name: "Book Fair Committee", member_count: 3 },
];

/** A fake D1 that HONOURS the statement's own kind term, so a filter that
 *  silently dropped it fails with a household on a classrooms-only request
 *  rather than passing a text scan. The name term never reaches SQL — it is
 *  applied in memory by the route — so every bound arg is a kind. */
function testEnv(seen: Seen[], rows: Row[] = ROWS): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      seen.push({ sql, args: this.args });
      const asked = this.args;
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

async function listing(
  url: string,
  rows: Row[] = ROWS,
): Promise<{ status: number; seen: Seen[]; ids: string[]; kinds: string[] }> {
  const seen: Seen[] = [];
  const res = await app().request(url, {}, testEnv(seen, rows));
  const body =
    res.status === 200
      ? ((await res.json()) as { groups: { id: string; kind: string }[] })
      : { groups: [] };
  return {
    status: res.status,
    seen,
    ids: body.groups.map((g) => g.id),
    kinds: body.groups.map((g) => g.kind),
  };
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
    const { status, seen, kinds } = await listing("/groups?q=");
    expect(status).toBe(200);
    expect(only(seen).sql).not.toContain("g.kind IN");
    expect(kinds).toEqual(["classroom", "household", "generic"]);
  });

  it("narrows the listing to one kind, keeping the name term", async () => {
    const { status, seen, ids } = await listing("/groups?q=grade&kind=classroom");
    expect(status).toBe(200);
    expect(only(seen).sql).toContain("g.kind IN (?)");
    expect(only(seen).args).toEqual(["classroom"]);
    expect(ids).toEqual(["01C"]);
    // The name term still narrows WITHIN the kind — both terms together.
    const miss = await listing("/groups?q=zzz&kind=classroom");
    expect(miss.ids).toEqual([]);
  });

  it("reads several kinds as OR, in one IN, deduped across both spellings", async () => {
    const { status, seen, kinds } = await listing(
      "/groups?kind=household,classroom&kind=household",
    );
    expect(status).toBe(200);
    expect(only(seen).sql).toContain("g.kind IN (?,?)");
    expect(only(seen).args.filter((a) => a === "household").length).toBe(1);
    expect(kinds.sort()).toEqual(["classroom", "household"]);
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

describe("GET /groups name search", () => {
  it("matches the full district name", async () => {
    const { ids } = await listing("/groups?q=shrestha");
    expect(ids).toEqual(["01C"]);
  });

  it("matches the rendered label, not only the stored name", async () => {
    // The table shows "Gr 2 - Shrestha"; typing what you read must find it.
    for (const q of ["gr 2", "Gr 2 - Shrestha"]) {
      const { ids } = await listing(`/groups?q=${encodeURIComponent(q)}`);
      expect(ids, q).toEqual(["01C"]);
    }
  });

  it("folds accents both ways", async () => {
    for (const q of ["renteria", "RENTERÍA"]) {
      const { ids } = await listing(`/groups?q=${encodeURIComponent(q)}`);
      expect(ids, q).toEqual(["01H"]);
    }
  });

  it("label matching never widens a kind-filtered listing", async () => {
    // A label is derived from the name, so a household can't ride in on a
    // classroom elision; the kind term already ran in SQL.
    const { ids } = await listing("/groups?q=gr%202&kind=household");
    expect(ids).toEqual([]);
  });

  it("caps the listing at 50 after the name term", async () => {
    const many: Row[] = Array.from({ length: 60 }, (_, i) => ({
      id: `01X${String(i).padStart(2, "0")}`,
      kind: "household",
      name: `Household ${i}`,
      member_count: 1,
    }));
    const { ids } = await listing("/groups?q=household", many);
    expect(ids.length).toBe(50);
  });
});
