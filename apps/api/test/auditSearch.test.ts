// Searching the audit log.
//
// The fake D1 records the statement and its binds, and answers from a tiny
// in-memory log by evaluating the LIKE terms it was handed — so a search that
// stopped covering a column the list renders (the deleted Person's name in
// `detail`, an actor's email) fails with a missing row rather than a scan.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { admin } from "../src/routes/admin.js";
import type { AuditEntryDTO } from "@sd/shared";
import type { AuthContext, HonoEnv } from "../src/env.js";
import { UnauthorizedError } from "../src/middleware/session.js";

const ADMIN: AuthContext = {
  userId: "01ADMIN",
  realUserId: "01ADMIN",
  email: "admin@eisenhower.edu",
  isSystemAdmin: true,
  sessionId: "01SESSION",
  activePersonId: "01ADMINPERSON",
  isMasquerading: false,
};

interface LogRow {
  id: string;
  action: string;
  entity_kind: string | null;
  entity_id: string | null;
  detail_json: string | null;
  ip: string | null;
  created_at: string;
  actor_email: string | null;
  masq_email: string | null;
}

const LOG: LogRow[] = [
  { id: "01A", action: "auth.signin", entity_kind: "user", entity_id: "01DANA", detail_json: null, ip: "10.0.0.1", created_at: "2026-09-01T00:00:00Z", actor_email: "dana@eisenhower.edu", masq_email: null },
  { id: "01B", action: "person.deleted", entity_kind: "person", entity_id: "01MILO", detail_json: JSON.stringify({ name: "Milo Ruiz" }), ip: null, created_at: "2026-09-02T00:00:00Z", actor_email: "dana@eisenhower.edu", masq_email: null },
  { id: "01C", action: "admin.action", entity_kind: "user", entity_id: "01X", detail_json: JSON.stringify({ op: "user_create", note: "100% done" }), ip: null, created_at: "2026-09-03T00:00:00Z", actor_email: "admin@eisenhower.edu", masq_email: "sam@example.com" },
  { id: "01D", action: "share.created", entity_kind: "share", entity_id: "01S", detail_json: "not json", ip: null, created_at: "2026-09-04T00:00:00Z", actor_email: null, masq_email: null },
];

/** SQLite LIKE with ESCAPE '\', case-insensitive for ASCII. */
function like(value: string | null, pattern: string): boolean {
  if (value === null) return false;
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\") { re += escapeRe(pattern[++i] ?? ""); continue; }
    re += ch === "%" ? ".*" : ch === "_" ? "." : escapeRe(ch);
  }
  return new RegExp(`^${re}$`, "is").test(value);
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const COLUMN_OF: Record<string, keyof LogRow> = {
  "a.action": "action", "a.entity_kind": "entity_kind", "a.entity_id": "entity_id",
  "actor.email": "actor_email", "masq.email": "masq_email", "a.ip": "ip", "a.detail_json": "detail_json",
};

function testEnv(seen: { sql: string; args: unknown[] }[]): HonoEnv["Bindings"] {
  const mk = (sql: string) => ({
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      seen.push({ sql, args: this.args });
      if (sql.includes("GROUP BY action")) {
        const counts = new Map<string, number>();
        for (const r of LOG) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
        return { results: [...counts].map(([action, n]) => ({ action, n })) };
      }
      // Evaluate the WHERE the route built: each `col LIKE ?` consumes one bind.
      const args = [...this.args];
      const limit = args.pop() as number;
      let rows = [...LOG].sort((a, b) => b.id.localeCompare(a.id));
      if (sql.includes("a.action = ?")) {
        const action = args.shift() as string;
        rows = rows.filter((r) => r.action === action);
      }
      const likeCols = [...sql.matchAll(/([a-z]+\.[a-z_]+) LIKE \? ESCAPE '\\'/g)].map((m) => m[1]!);
      if (likeCols.length) {
        const terms = args.splice(0, likeCols.length) as string[];
        rows = rows.filter((r) => likeCols.some((col, i) => like(r[COLUMN_OF[col]!] as string | null, terms[i]!)));
      }
      if (sql.includes("a.id < ?")) {
        const before = args.shift() as string;
        rows = rows.filter((r) => r.id < before);
      }
      return { results: rows.slice(0, limit) };
    },
  });
  return { DB: { prepare: (sql: string) => mk(sql) } } as unknown as HonoEnv["Bindings"];
}

function appWith(auth: AuthContext | null): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();
  app.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      c.set("audit", []);
      if (auth) c.set("auth", auth);
      await next();
    }),
  );
  app.route("/admin", admin);
  app.onError((err, c) => {
    if (err instanceof UnauthorizedError) return c.json({ error: "unauthorized" }, 401);
    throw err;
  });
  return app;
}

async function search(qs: string, auth: AuthContext | null = ADMIN) {
  const seen: { sql: string; args: unknown[] }[] = [];
  const res = await appWith(auth).request(`/admin/audit${qs}`, {}, testEnv(seen));
  return { res, seen, body: res.ok ? ((await res.json()) as { entries: AuditEntryDTO[]; nextBefore: string | null }) : null };
}

const ids = (entries: AuditEntryDTO[] | undefined) => (entries ?? []).map((e) => e.id);

describe("GET /admin/audit?q=", () => {
  it("finds a deleted Person by the name only their audit row still holds", async () => {
    const { body } = await search("?q=milo");
    expect(ids(body?.entries)).toEqual(["01B"]);
    expect(body?.entries[0]?.detail).toEqual({ name: "Milo Ruiz" });
  });

  it("matches actor and masquerade-target emails, entity ids and ip", async () => {
    expect(ids((await search("?q=DANA@")).body?.entries)).toEqual(["01B", "01A"]);
    expect(ids((await search("?q=sam@example")).body?.entries)).toEqual(["01C"]);
    expect(ids((await search("?q=01MILO")).body?.entries)).toEqual(["01B"]);
    expect(ids((await search("?q=10.0.0")).body?.entries)).toEqual(["01A"]);
  });

  it("treats % and _ as themselves, not wildcards", async () => {
    // `%` alone would match every row if it reached LIKE unescaped.
    expect(ids((await search("?q=%25")).body?.entries)).toEqual(["01C"]);
    // `_` would match any single character — "user_create" only, not "user".
    expect(ids((await search("?q=r_c")).body?.entries)).toEqual(["01C"]);
  });

  it("ANDs the search with the action filter, and binds every value", async () => {
    const { body, seen } = await search("?action=auth.signin&q=dana");
    expect(ids(body?.entries)).toEqual(["01A"]);
    expect(seen[0]?.sql).not.toContain("dana");
  });

  it("does not search columns the list never shows", async () => {
    const { seen } = await search("?q=x");
    expect(seen[0]?.sql).not.toMatch(/user_agent\s+LIKE|row_hash\s+LIKE|prev_hash\s+LIKE/);
  });

  it("shows a detail blob that won't parse rather than dropping it", async () => {
    const { body } = await search("?q=share.created");
    expect(body?.entries[0]?.detail).toEqual({ raw: "not json" });
  });

  it("with no q, returns the whole log as before", async () => {
    const { body, seen } = await search("");
    expect(ids(body?.entries)).toEqual(["01D", "01C", "01B", "01A"]);
    expect(seen[0]?.sql).not.toContain("LIKE");
  });

  it("is system-admin only", async () => {
    const { res } = await search("?q=milo", { ...ADMIN, isSystemAdmin: false });
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/audit/actions", () => {
  it("lists the actions the log actually holds, with counts", async () => {
    const seen: { sql: string; args: unknown[] }[] = [];
    const res = await appWith(ADMIN).request("/admin/audit/actions", {}, testEnv(seen));
    const body = (await res.json()) as { actions: { action: string; count: number }[] };
    expect(body.actions).toContainEqual({ action: "person.deleted", count: 1 });
    expect(body.actions).toHaveLength(4);
  });

  it("is system-admin only", async () => {
    const res = await appWith({ ...ADMIN, isSystemAdmin: false }).request("/admin/audit/actions", {}, testEnv([]));
    expect(res.status).toBe(403);
  });
});
