// Whole-database backup and restore.
//
// BEHAVIOURAL, not textual, for the reason `slackNotify.test.ts` and
// `ptoAccess.test.ts` are: every interesting property here is about what the
// statements DO, and a scan for the right words would pass a restore that
// deleted `audit_log` as readily as one that doesn't.
//
// The fake D1 below answers `sqlite_master` and `PRAGMA table_info` with a small
// schema and records every statement, so a test can assert the exact shape of
// what would be written — including what is NOT written, which is most of the
// point of this file.

import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  EXCLUDED_TABLES,
  RESTORE_SKIPPED_TABLES,
  countRows,
  exportBackup,
  listBackupTables,
  planRestore,
  runRestore,
} from "../src/lib/backup.js";
import type { Env } from "../src/env.js";

/** The live schema the fake reports. Deliberately includes all four excluded
 *  tables and `audit_log`, since their absence from the output is the assertion. */
const SCHEMA: Record<string, string[]> = {
  person: ["id", "first_name", "last_name", "unlisted_at"],
  user: ["id", "email", "is_system_admin", "disabled_at"],
  contact_item: ["id", "owner_id", "value", "geo_lat", "geo_lng"],
  audit_log: ["id", "action", "row_hash"],
  session: ["id", "user_id"],
  auth_token: ["id", "token_hash"],
  newsletter_confirmation: ["id", "token_hash"],
  control_invite: ["id", "token_hash"],
  sqlite_sequence: ["name", "seq"],
  d1_migrations: ["id", "name"],
  _cf_KV: ["key"],
};

/** Rows the fake hands back for a full-table read. */
const ROWS: Record<string, Record<string, unknown>[]> = {
  person: [
    { id: "01P1", first_name: "Dana", last_name: "Ruiz", unlisted_at: null },
    // The unlisted Person is the one a naive "compose the gate everywhere"
    // reading would drop — and dropping her from a backup means a restore
    // DELETES her. She has to come back.
    { id: "01P2", first_name: "Milo", last_name: "Ruiz", unlisted_at: "2026-01-01T00:00:00.000Z" },
  ],
  user: [{ id: "01U1", email: "dana@eisenhower.edu", is_system_admin: 1, disabled_at: null }],
  contact_item: [{ id: "01C1", owner_id: "01P1", value: "12 Elm St", geo_lat: 44.9, geo_lng: -93.4 }],
  audit_log: [{ id: "01A1", action: "auth.signin", row_hash: "abc" }],
  session: [{ id: "cookie-value", user_id: "01U1" }],
  auth_token: [{ id: "01T1", token_hash: "hash" }],
  newsletter_confirmation: [{ id: "01N1", token_hash: "hash" }],
  control_invite: [{ id: "01I1", token_hash: "hash" }],
};

interface Recorded {
  sql: string;
  binds: unknown[];
}

function fakeEnv(rows: Record<string, Record<string, unknown>[]> = ROWS): {
  env: Env;
  statements: Recorded[];
} {
  const statements: Recorded[] = [];

  function results(sql: string, binds: unknown[]): unknown[] {
    if (sql.includes("FROM sqlite_master")) {
      return Object.keys(SCHEMA).map((name) => ({ name }));
    }
    const pragma = /PRAGMA table_info\("([^"]+)"\)/.exec(sql);
    if (pragma) return (SCHEMA[pragma[1]!] ?? []).map((name) => ({ name }));
    const read = /FROM "([^"]+)" WHERE rowid > \?/.exec(sql);
    if (read) {
      const after = Number(binds[0] ?? 0);
      // rowid is 1-based and dense here, which is all the keyset walk needs.
      return (rows[read[1]!] ?? [])
        .map((r, i) => ({ __rowid: i + 1, ...r }))
        .filter((r) => (r.__rowid as number) > after);
    }
    return [];
  }

  // Statements are recorded where they EXECUTE, not where they're prepared —
  // `runRestore` hands most of its work to `batch()` without ever calling
  // `.run()`, and a fake that only watched `.run()` would have reported a
  // restore that deleted nothing.
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          sql,
          binds: [] as unknown[],
          bind(...args: unknown[]) {
            this.binds = args;
            return this;
          },
          async all() {
            statements.push({ sql, binds: this.binds });
            return { results: results(sql, this.binds) };
          },
          async run() {
            statements.push({ sql, binds: this.binds });
            return { meta: { changes: 1 } };
          },
        };
      },
      async batch(stmts: Recorded[]) {
        for (const s of stmts) statements.push({ sql: s.sql, binds: s.binds });
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
    SCHOOL_NAME: "Eisenhower Elementary",
  } as unknown as Env;
  return { env, statements };
}

describe("listBackupTables", () => {
  it("discovers tables instead of listing them, so a new migration is covered", async () => {
    const { env } = fakeEnv();
    const tables = await listBackupTables(env);
    // Nothing in src names these; they arrive from sqlite_master.
    expect(tables).toContain("person");
    expect(tables).toContain("contact_item");
  });

  it("leaves out Cloudflare's and SQLite's own bookkeeping", async () => {
    const { env } = fakeEnv();
    const tables = await listBackupTables(env);
    expect(tables).not.toContain("sqlite_sequence");
    expect(tables).not.toContain("d1_migrations");
    expect(tables).not.toContain("_cf_KV");
  });

  it("leaves out every table that holds a live capability", async () => {
    const { env } = fakeEnv();
    const tables = await listBackupTables(env);
    for (const t of EXCLUDED_TABLES) expect(tables).not.toContain(t);
  });
});

describe("exportBackup", () => {
  it("carries the unlisted Person, and the coordinates no DTO may hold", async () => {
    const { env } = fakeEnv();
    const doc = await exportBackup(env);
    // A backup that composed the enumeration gate would omit 01P2 — and a
    // restore from that file would delete her from the directory.
    expect(doc.tables.person).toHaveLength(2);
    expect(doc.tables.person!.map((p) => p.id)).toContain("01P2");
    // Invariant 2 keeps geo out of every DTO. A backup is not a DTO: strip
    // these and a restore silently turns neighbour discovery off.
    expect(doc.tables.contact_item![0]).toMatchObject({ geo_lat: 44.9, geo_lng: -93.4 });
  });

  it("never writes a session cookie or a token into the file", async () => {
    const { env } = fakeEnv();
    const doc = await exportBackup(env);
    for (const t of EXCLUDED_TABLES) expect(doc.tables[t]).toBeUndefined();
    // Belt as well as braces: the raw cookie value must not appear anywhere.
    expect(JSON.stringify(doc)).not.toContain("cookie-value");
  });

  it("includes the audit log — a backup missing it is not a record", async () => {
    const { env } = fakeEnv();
    const doc = await exportBackup(env);
    expect(doc.tables.audit_log).toHaveLength(1);
  });

  it("strips the rowid it pages on rather than leaking it into the file", async () => {
    const { env } = fakeEnv();
    const doc = await exportBackup(env);
    expect(Object.keys(doc.tables.person![0]!)).not.toContain("__rowid");
  });

  it("reports counts per table", async () => {
    const { env } = fakeEnv();
    const counts = countRows(await exportBackup(env));
    expect(counts.find((c) => c.table === "person")?.rows).toBe(2);
  });
});

/** A file this database would accept: every live table present, an enabled
 *  admin in `user`. Tests below mutate copies of it. */
async function goodDoc(env: Env) {
  return await exportBackup(env);
}

describe("planRestore", () => {
  it("refuses a document from a format it doesn't know", async () => {
    const { env } = fakeEnv();
    const doc = { ...(await goodDoc(env)), format: BACKUP_FORMAT + 1 };
    const plan = await planRestore(env, doc, "01U1");
    expect(plan.errors.join(" ")).toContain("format");
    expect(plan.tables).toEqual([]);
  });

  it("refuses a table this database doesn't have", async () => {
    const { env } = fakeEnv();
    const doc = await goodDoc(env);
    doc.tables.secrets = [{ id: "x" }];
    const plan = await planRestore(env, doc, "01U1");
    expect(plan.errors.join(" ")).toContain("secrets");
  });

  it("refuses a column this database doesn't have — the schema-drift check and the injection guard in one", async () => {
    const { env } = fakeEnv();
    const doc = await goodDoc(env);
    // Column names are interpolated into the INSERT (identifiers can't be
    // bound), so this is the only thing standing between a crafted file and a
    // statement of the uploader's choosing.
    doc.tables.person!.push({ id: "01P3", 'first_name") VALUES (1); DROP TABLE person; --': "x" });
    const plan = await planRestore(env, doc, "01U1");
    expect(plan.errors.join(" ")).toContain("column this database doesn't");
  });

  it("refuses to empty a live table the file never mentions", async () => {
    const { env } = fakeEnv();
    const doc = await goodDoc(env);
    delete doc.tables.contact_item;
    const plan = await planRestore(env, doc, "01U1");
    // Emptying something nobody named is the failure invariant 27 describes.
    expect(plan.errors.join(" ")).toContain("contact_item");
    expect(plan.errors.join(" ")).toContain("empty");
  });

  it("refuses a backup that would leave nobody able to administer the instance", async () => {
    const { env } = fakeEnv();
    const doc = await goodDoc(env);
    doc.tables.user = [{ id: "01U9", email: "x@y.z", is_system_admin: 0, disabled_at: null }];
    const plan = await planRestore(env, doc, "01U1");
    expect(plan.errors.join(" ")).toContain("lock everyone out");
  });

  it("counts a DISABLED admin as no admin at all", async () => {
    const { env } = fakeEnv();
    const doc = await goodDoc(env);
    doc.tables.user = [{ id: "01U1", email: "d@e.f", is_system_admin: 1, disabled_at: "2026-01-01T00:00:00.000Z" }];
    const plan = await planRestore(env, doc, "01U1");
    expect(plan.errors.join(" ")).toContain("lock everyone out");
  });

  it("warns, but does not refuse, when the admin running it isn't in the file", async () => {
    const { env } = fakeEnv();
    const doc = await goodDoc(env);
    const plan = await planRestore(env, doc, "01U-SOMEONE-ELSE");
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.join(" ")).toContain("signed out");
  });

  it("accepts a good file and reports the audit log as kept rather than written", async () => {
    const { env } = fakeEnv();
    const plan = await planRestore(env, await goodDoc(env), "01U1");
    expect(plan.errors).toEqual([]);
    const audit = plan.tables.find((t) => t.table === "audit_log");
    expect(audit?.skipped).toBe(true);
    expect(plan.tables.find((t) => t.table === "person")?.skipped).toBe(false);
  });

  it("says out loud what a restore does not bring back", async () => {
    const { env } = fakeEnv();
    const plan = await planRestore(env, await goodDoc(env), "01U1");
    const warnings = plan.warnings.join(" ");
    expect(warnings).toContain("invitations");
    expect(warnings).toContain("audit log");
  });
});

describe("runRestore", () => {
  async function restored() {
    const { env: source } = fakeEnv();
    const doc = await exportBackup(source);
    const { env, statements } = fakeEnv();
    const written = await runRestore(env, doc);
    return { statements, written, doc };
  }

  it("never deletes the audit log", async () => {
    const { statements } = await restored();
    // Invariant 5: append-only and hash-chained. A restore that emptied it
    // would break the chain and erase the record of the restore itself.
    for (const t of RESTORE_SKIPPED_TABLES) {
      expect(statements.some((s) => s.sql.includes(`DELETE FROM "${t}"`))).toBe(false);
      expect(statements.some((s) => s.sql.includes(`INSERT INTO "${t}"`))).toBe(false);
    }
  });

  it("never writes the capability tables either", async () => {
    const { statements } = await restored();
    for (const t of EXCLUDED_TABLES) {
      expect(statements.some((s) => s.sql.includes(`"${t}"`))).toBe(false);
    }
  });

  it("empties every table it writes before inserting into any of them", async () => {
    const { statements } = await restored();
    const sql = statements.map((s) => s.sql);
    const lastDelete = sql.reduce((last, s, i) => (s.startsWith("DELETE FROM") ? i : last), -1);
    const firstInsert = sql.findIndex((s) => s.startsWith("INSERT INTO"));
    expect(lastDelete).toBeGreaterThanOrEqual(0);
    expect(firstInsert).toBeGreaterThan(lastDelete);
  });

  it("round-trips every row, the unlisted Person included", async () => {
    const { statements, written } = await restored();
    expect(written).toBe(2 + 1 + 1); // person + user + contact_item
    const persons = statements.filter((s) => s.sql.startsWith('INSERT INTO "person"'));
    expect(persons).toHaveLength(2);
    expect(persons.flatMap((s) => s.binds)).toContain("01P2");
  });

  it("binds values rather than interpolating them", async () => {
    const { statements } = await restored();
    const insert = statements.find((s) => s.sql.startsWith('INSERT INTO "contact_item"'))!;
    expect(insert.sql).toContain("VALUES (?, ?, ?, ?, ?)");
    expect(insert.binds).toContain("12 Elm St");
  });
});
