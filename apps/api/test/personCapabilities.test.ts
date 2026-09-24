// PATCH /persons/:id with `capabilities` — the tags a Controller may change on
// a Person they manage, after the fact. Three things are pinned:
//
//   THE REWRITE IS SCOPED TO THE ASSIGNABLE SET ON BOTH SIDES. The DELETE names
//   ASSIGNABLE_CAPABILITIES rather than clearing the row's grants, so
//   `household_admin` — authority over a household, granted by `POST /groups`
//   and `bindInvite`, never typed — survives whether the client omits it or
//   tries to send it. An unscoped `DELETE … WHERE person_id = ?` would let a
//   parent editing their own tags quietly drop their own household authority;
//   an unfiltered INSERT would let them mint it.
//
//   NAME AND TAGS ARE ONE BATCH. D1 has no transaction, so the two writes ride a
//   single `batch()` and a save is all-or-nothing.
//
//   OMITTING THE FIELD TOUCHES NOTHING. A name-only PATCH from an older client
//   must not be read as "and clear the tags".

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { describe, expect, it } from "vitest";
import { ASSIGNABLE_CAPABILITIES } from "@sd/shared";
import { persons } from "../src/routes/persons.js";
import type { AuditDraft } from "../src/lib/audit.js";
import type { AuthContext, HonoEnv } from "../src/env.js";

interface Captured {
  sql: string;
  args: unknown[];
}

function testEnv(captured: Captured[]): HonoEnv["Bindings"] {
  const stmt = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async run() {
      captured.push({ sql: this.sql, args: this.args });
      return { meta: { changes: 1 } };
    },
    // `buildProfile` runs after the write; an empty read makes it return null,
    // which is all this test needs of it.
    async first() {
      return null;
    },
    async all() {
      return { results: [] };
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
  isApproved: true,
};

let audit: AuditDraft[] = [];

function app(controls = true): Hono<HonoEnv> {
  const a = new Hono<HonoEnv>();
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      audit = [];
      c.set("audit", audit);
      c.set("auth", AUTH);
      await next();
    }),
  );
  a.use(
    "*",
    createMiddleware<HonoEnv>(async (c, next) => {
      const real = c.env.DB.prepare.bind(c.env.DB);
      (c.env as { DB: unknown }).DB = {
        ...c.env.DB,
        prepare: (sql: string) => {
          if (sql.includes("FROM control WHERE user_id = ? AND person_id")) {
            return { bind: () => ({ first: async () => (controls ? { ok: 1 } : null) }) };
          }
          return real(sql);
        },
        batch: c.env.DB.batch.bind(c.env.DB),
      };
      await next();
    }),
  );
  a.route("/persons", persons);
  return a;
}

async function patch(payload: Record<string, unknown>, opts: { controls?: boolean } = {}) {
  const captured: Captured[] = [];
  const res = await app(opts.controls ?? true).request(
    "/persons/01MILO",
    { method: "PATCH", body: JSON.stringify(payload), headers: { "content-type": "application/json" } },
    testEnv(captured),
  );
  return { res, captured, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const grantDeletes = (c: Captured[]) => c.filter((s) => s.sql.startsWith("DELETE FROM capability_grant"));
const grantInserts = (c: Captured[]) => c.filter((s) => s.sql.startsWith("INSERT INTO capability_grant"));
const nameUpdates = (c: Captured[]) => c.filter((s) => s.sql.startsWith("UPDATE person"));

describe("PATCH /persons/:id capabilities", () => {
  it("refuses a caller who does not control the Person", async () => {
    const { res, captured } = await patch({ capabilities: ["student"] }, { controls: false });
    expect(res.status).toBe(403);
    expect(captured).toHaveLength(0);
  });

  it("replaces the assignable set: one scoped DELETE, one INSERT per tag", async () => {
    const { res, captured } = await patch({ capabilities: ["student", "parent"] });
    expect(res.status).toBe(200);

    const del = grantDeletes(captured);
    expect(del).toHaveLength(1);
    // Scoped to the assignable set — never `WHERE person_id = ?` alone.
    expect(del[0]?.sql).toMatch(/capability IN \(/);
    expect(del[0]?.args).toEqual(["01MILO", ...ASSIGNABLE_CAPABILITIES]);
    expect(ASSIGNABLE_CAPABILITIES).not.toContain("household_admin");

    expect(grantInserts(captured).map((s) => s.args)).toEqual([
      ["01MILO", "student"],
      ["01MILO", "parent"],
    ]);

    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("person.updated");
    expect(audit[0]?.detail).toEqual({ fields: ["capabilities"], capabilities: ["student", "parent"] });
  });

  it("neither grants nor revokes household_admin, and drops unknown codes", async () => {
    const { res, captured } = await patch({ capabilities: ["household_admin", "wizard", "teacher", "teacher"] });
    expect(res.status).toBe(200);
    expect(grantInserts(captured).map((s) => s.args)).toEqual([["01MILO", "teacher"]]);
    for (const d of grantDeletes(captured)) expect(d.args).not.toContain("household_admin");
  });

  it("an empty list clears the assignable tags and is not 'nothing to update'", async () => {
    const { res, captured } = await patch({ capabilities: [] });
    expect(res.status).toBe(200);
    expect(grantDeletes(captured)).toHaveLength(1);
    expect(grantInserts(captured)).toHaveLength(0);
  });

  it("a name-only PATCH leaves the grants alone", async () => {
    const { res, captured } = await patch({ firstName: "Milo" });
    expect(res.status).toBe(200);
    expect(nameUpdates(captured)).toHaveLength(1);
    expect(grantDeletes(captured)).toHaveLength(0);
    expect(grantInserts(captured)).toHaveLength(0);
    expect(audit[0]?.detail).toEqual({ fields: ["first_name"] });
  });

  it("name and tags ride one batch, name first", async () => {
    const { captured } = await patch({ firstName: "Milo", capabilities: ["student"] });
    expect(captured.map((s) => s.sql.split(" ")[0])).toEqual(["UPDATE", "DELETE", "INSERT"]);
  });

  it("still 400s with nothing to update", async () => {
    const { res, body, captured } = await patch({});
    expect(res.status).toBe(400);
    expect(body?.error).toBe("nothing_to_update");
    expect(captured).toHaveLength(0);
  });
});
