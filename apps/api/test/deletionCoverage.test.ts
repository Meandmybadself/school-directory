// Deletion coverage — the schema-shaped tripwire for the two cascades.
//
// D1 ENFORCES foreign keys, and a `DB.batch` is atomic. So a cascade that
// forgets one `REFERENCES user(id)` column does not leave a dangling row — it
// fails the whole delete with `FOREIGN KEY constraint failed`, and the admin sees
// "Couldn't delete that account" with nothing to explain it. The first version
// of `userDeletionStmts` shipped that way twice over: it NULLed
// `newsletter_subscriber.user_id`, a column that does not exist (the table is
// `newsletter_send`), and it never touched `auth_token.invited_by` or
// `share.created_by`, which do. Every route test passed, because a fake D1 has no
// schema to disagree with.
//
// This test reads the migrations instead. It collects every column that
// references `user`, `person` or `grp`, renders the two cascades, and asserts
// that (a) every table.column a cascade names exists, and (b) every referencing
// column is covered — deleted, NULLed, or reached through a `WHERE` on that
// column. It is `test/personListable.test.ts`'s kind of test: it catches the
// column nobody remembered rather than the one somebody tested. Same ceiling,
// too — it reads `CREATE TABLE` and `ALTER TABLE … ADD COLUMN` bodies, so a
// constraint written some other way would slip past it.

import { describe, expect, it } from "vitest";
import { personCascadeStmts } from "../src/lib/personDelete.js";
import { userDeletionStmts } from "../src/lib/userAdmin.js";
import type { Env } from "../src/env.js";
import type { UserDeletionImpactDTO } from "@sd/shared";

// Read through Vite rather than `node:fs`, for the reason
// `test/personListable.test.ts` gives: this package types the Workers runtime
// and must not pull Node's globals in front of `src`.
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      opts: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>;
  }
}

const MIGRATIONS: Record<string, string> = import.meta.glob("../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

interface Schema {
  /** table → set of column names */
  columns: Map<string, Set<string>>;
  /** referenced table → [{ table, column }] */
  refs: Map<string, { table: string; column: string }[]>;
}

function readSchema(): Schema {
  const columns = new Map<string, Set<string>>();
  const refs = new Map<string, { table: string; column: string }[]>();
  const col = (table: string, name: string) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(name);
  };
  const ref = (table: string, column: string, line: string) => {
    const m = /REFERENCES\s+(\w+)\s*\(\s*id\s*\)/.exec(line);
    if (!m) return;
    if (!refs.has(m[1]!)) refs.set(m[1]!, []);
    refs.get(m[1]!)!.push({ table, column });
  };
  const strip = (l: string) => l.replace(/--.*$/, "");

  for (const file of Object.keys(MIGRATIONS).sort()) {
    const text = MIGRATIONS[file]!;
    // CREATE TABLE x ( … );  — one column definition per line, by convention.
    for (const m of text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const table = m[1]!;
      for (const raw of m[2]!.split("\n")) {
        const line = strip(raw).trim();
        const c = /^(\w+)\s+(TEXT|INTEGER|REAL|BLOB)\b/.exec(line);
        if (!c) continue;
        col(table, c[1]!);
        ref(table, c[1]!, line);
      }
    }
    for (const m of text.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)([^;]*);/g)) {
      col(m[1]!, m[2]!);
      ref(m[1]!, m[2]!, strip(m[3]!));
    }
  }
  return { columns, refs };
}

/** A D1 stand-in that only records the SQL text of each prepared statement. */
function recordingEnv(): { env: Env; sql: string[] } {
  const sql: string[] = [];
  const env = {
    DB: {
      prepare(text: string) {
        sql.push(text.replace(/\s+/g, " ").trim());
        return { bind: () => ({}) };
      },
    },
  } as unknown as Env;
  return { env, sql };
}

/** Every (table, column) pair a rendered statement writes through or filters on. */
function touched(stmts: string[]): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  for (const s of stmts) {
    const t = /^(?:DELETE FROM|UPDATE)\s+(\w+)/.exec(s);
    if (!t) continue;
    const table = t[1]!;
    // A subselect's columns belong to ITS table, not this statement's.
    const own = s.replace(/\(\s*SELECT[^)]*\)/gi, "");
    for (const m of own.matchAll(/(\w+)\s*=\s*(?:\?|NULL)/g)) out.push({ table, column: m[1]! });
  }
  return out;
}

const IMPACT: UserDeletionImpactDTO = {
  user: { id: "U", email: "u@example.com", disabled: true },
  orphanedPersons: [{ id: "P", name: "P" }],
  sharedPersons: [],
  emptiedHouseholds: [{ id: "H", name: "H" }],
  retainedGroupsAdministered: [],
  auditEntries: 0,
  volunteerClaimsWithdrawn: 0,
  boardCommentsDeleted: 0,
  sharesWithdrawn: 0,
};

describe("deletion cascades against the real schema", () => {
  const schema = readSchema();

  it("read the migrations", () => {
    expect(schema.columns.get("user")).toContain("email");
    expect(schema.refs.get("user")!.length).toBeGreaterThan(10);
    expect(schema.refs.get("person")!.length).toBeGreaterThan(4);
  });

  it("names only columns that exist (user deletion)", () => {
    const { env, sql } = recordingEnv();
    userDeletionStmts(env, "U", "u@example.com", IMPACT);
    for (const { table, column } of touched(sql)) {
      expect(schema.columns.has(table), `table ${table}`).toBe(true);
      expect(schema.columns.get(table)!.has(column), `${table}.${column}`).toBe(true);
    }
  });

  it("names only columns that exist (person cascade)", () => {
    const { env, sql } = recordingEnv();
    personCascadeStmts(env, "P");
    for (const { table, column } of touched(sql)) {
      expect(schema.columns.has(table), `table ${table}`).toBe(true);
      expect(schema.columns.get(table)!.has(column), `${table}.${column}`).toBe(true);
    }
  });

  it("covers every column that REFERENCES user(id)", () => {
    const { env, sql } = recordingEnv();
    userDeletionStmts(env, "U", "u@example.com", IMPACT);
    const seen = new Set(touched(sql).map((t) => `${t.table}.${t.column}`));
    // `auth_token` is keyed by email, not user id — `invited_by` is the FK.
    const missing = schema.refs.get("user")!.filter((r) => !seen.has(`${r.table}.${r.column}`));
    expect(missing).toEqual([]);
  });

  it("covers every column that REFERENCES person(id)", () => {
    const { env, sql } = recordingEnv();
    personCascadeStmts(env, "P");
    const seen = new Set(touched(sql).map((t) => `${t.table}.${t.column}`));
    const missing = schema.refs.get("person")!.filter((r) => !seen.has(`${r.table}.${r.column}`));
    expect(missing).toEqual([]);
  });

  it("clears what points at an emptied household before deleting it", () => {
    const { env, sql } = recordingEnv();
    userDeletionStmts(env, "U", "u@example.com", IMPACT);
    const seen = new Set(touched(sql).map((t) => `${t.table}.${t.column}`));
    // `membership.group_id`: its rows are the orphans', deleted per Person.
    // `grp.parent_id`: a household has no children. The invite columns from
    // migration 0021 always sit beside a `person_id`, which the person cascade
    // clears — so each is accepted as covered when its ROW is deleted by the
    // person cascade, i.e. the table appears in a DELETE keyed on person_id.
    const deletedByPerson = new Set(
      sql.filter((s) => /^DELETE FROM \w+ WHERE person_id = \?/.test(s)).map((s) => /^DELETE FROM (\w+)/.exec(s)![1]),
    );
    const missing = schema
      .refs.get("grp")!
      .filter((r) => r.table !== "grp")
      .filter((r) => !seen.has(`${r.table}.${r.column}`) && !deletedByPerson.has(r.table));
    expect(missing).toEqual([]);
  });
});
