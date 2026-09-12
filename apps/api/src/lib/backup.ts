// Whole-database backup and restore (D1 → JSON → D1).
//
// This file is the ONE place in the codebase whose job is to move data OUT of
// the system without narrowing it, so it is worth being explicit about how it
// differs from everything around it.
//
// WHY THIS IS NOT A PROJECTION. Every other seam here — `publicEventOf`,
// `publicSheetOf`, `issuePageOf`, `publicProductOf`, `slackLinesOf` — is built
// field by field precisely so a column added next year does NOT reach a reader
// until somebody decides it should (invariant 12). A backup inverts that
// property: a column nobody remembered is a column silently ABSENT from the
// file, and the day it matters is the day somebody restores and finds it gone.
// So the default here is "include", and the seam is a short EXCLUDED list
// rather than a long allowlist. Tables are discovered from `sqlite_master`,
// which means a table added by a future migration is backed up by construction.
//
// WHAT THAT COSTS, stated rather than implied. The file holds `geo_lat` /
// `geo_lng` (invariant 2 keeps those out of every DTO), every `private` contact
// item, every member's email. It is the directory, not a view of it. That is
// what a backup has to be to be worth taking — restoring a file with the
// coordinates stripped would silently turn neighbour discovery off for every
// family in it. The mitigations are that only a system admin can ask for one,
// that asking is an audited, Slack-announced act, and that the UI says plainly
// what the file contains.
//
// WHAT IT DOES NOT COVER. D1 only. Profile photos and newsletter images live in
// R2 (`PHOTOS`, `NEWSLETTER_MEDIA`) and are NOT in the file: a restored
// `person.photo_object_key` points at an object that still has to be there.
// Restoring into a fresh bucket gives you a directory with broken portraits,
// not a corrupt one, which is the right way for that gap to fail.

import type { BackupDocument } from "@sd/shared";
import type { Env } from "../env.js";
import { nowIso } from "./time.js";

/** Bumped when the shape of a document changes incompatibly. A restore refuses
 *  anything it does not recognise rather than guessing — a half-understood
 *  backup is worse than a rejected one. */
export const BACKUP_FORMAT = 1;

/** Tables a backup never contains, and it is deliberately the SAME four
 *  `lib/sweep.ts` sweeps, for a related reason.
 *
 *  Every one of them holds a live capability or backs a rate limit that counts
 *  rows, and writing them to a file has a cost in both directions:
 *
 *  · `session.id` IS the cookie value, stored in the clear — a backup file
 *    containing them is a file that signs its holder in as anybody who was
 *    logged in when it was taken. Nothing else in this schema is like that.
 *  · `auth_token` and `newsletter_confirmation` hold hashes, so the file leaks
 *    nothing, but RESTORING one resurrects capabilities: a magic link consumed
 *    since the snapshot comes back with `consumed_at` null and works again,
 *    which is exactly the single-use guarantee /auth/callback exists to make
 *    (invariant 19). Both also back a row-counting cap whose retention is a
 *    security parameter, and a restore would reset it.
 *  · `control_invite` is the same shape one level down: a cancelled invitation
 *    to co-control somebody's child would come back pending.
 *
 *  The practical consequence, which the UI states: a restore does not bring
 *  back pending sign-in links or invitations. They get re-sent. It also leaves
 *  every current session alone, which is why the admin performing the restore
 *  is still signed in when it finishes. */
export const EXCLUDED_TABLES = ["session", "auth_token", "newsletter_confirmation", "control_invite"] as const;

/** Exported, never written back.
 *
 *  `audit_log` is append-only and hash-chained (invariant 5), which is why it
 *  is deliberately absent from `lib/sweep.ts` and why deleting a User leaves it
 *  untouched. A restore that emptied it would break the chain and erase the
 *  record of everything done up to the restore — including the restore. So the
 *  log is in the FILE (a backup missing it is not a record of anything) and the
 *  live table is never touched: the chain runs continuously across a restore,
 *  and the `admin.action` row this operation appends is the one thing a restore
 *  cannot erase.
 *
 *  The consequence to know: after a restore, old rows may name Persons and
 *  Users the restored data no longer contains. That is what a historical record
 *  looks like, not a fault. */
export const RESTORE_SKIPPED_TABLES = ["audit_log"] as const;

/** Cloudflare's own bookkeeping, plus SQLite's. Never ours to move. */
const INTERNAL_PREFIXES = ["sqlite_", "_cf_", "d1_"];

/** A table name we are willing to interpolate. Names come from `sqlite_master`
 *  and, on restore, from a file an admin uploaded — so they are checked against
 *  the live set AND against this before they reach a statement. Values are
 *  always bound (never interpolated); identifiers cannot be. */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Rows read per round trip. Keyset-paged on `rowid` rather than OFFSET so a
 *  write landing mid-export can't make the walk skip or repeat a row. Every
 *  table in this schema is an ordinary rowid table; a future WITHOUT ROWID one
 *  would fail here loudly, which is the right failure for a backup. */
const PAGE = 1000;

/** Rows per D1 batch on restore. One statement per row — a multi-row INSERT
 *  would have to stay under the bound-variable ceiling, and the widest table
 *  here is already twenty-odd columns. */
const BATCH = 50;

/** Refuse a file so large the Worker would die part-way through writing it.
 *  A school directory is four figures of rows; six is somebody's mistake. */
export const MAX_RESTORE_ROWS = 500_000;

/** The document shape lives in `@sd/shared` beside the other wire types, so the
 *  admin screen that uploads a file and this file that writes one cannot drift.
 *  Tables with no rows are present as `[]`, never omitted: a restore reads an
 *  absent table as "this file predates the migration that added it" and
 *  refuses, so an empty table has to be able to say "empty", not "missing". */
export type { BackupDocument };

export interface BackupTableCount {
  table: string;
  rows: number;
}

function quoted(table: string): string {
  if (!SAFE_IDENT.test(table)) throw new Error(`unsafe table name: ${table}`);
  return `"${table}"`;
}

/** Every table this instance's schema actually has, minus Cloudflare's and
 *  minus EXCLUDED_TABLES. Read from `sqlite_master` rather than from a list in
 *  this file on purpose — see the header: for a backup, a forgotten table is
 *  data lost, so discovery is the safe default and the exclusions are the part
 *  somebody has to write down. */
export async function listBackupTables(env: Env): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();
  const excluded = new Set<string>(EXCLUDED_TABLES);
  return rows.results
    .map((r) => r.name)
    .filter(
      (name) =>
        SAFE_IDENT.test(name) &&
        !INTERNAL_PREFIXES.some((p) => name.startsWith(p)) &&
        !excluded.has(name),
    );
}

/** The live column set of one table, used to validate an uploaded file's row
 *  keys before any of them reach an INSERT. */
export async function tableColumns(env: Env, table: string): Promise<string[]> {
  const info = await env.DB.prepare(`PRAGMA table_info(${quoted(table)})`).all<{ name: string }>();
  return info.results.map((r) => r.name);
}

/**
 * Read one table in full, keyset-paged.
 *
 * This is the statement that reads `FROM person` — and `FROM contact_item`, and
 * every other table — with the name interpolated rather than written out, so
 * the invariant-21 source scan cannot see it. That is precisely the blind spot
 * `test/personListable.test.ts` names in its own header (a dynamically built
 * table name slips past), so the answer is written here where a reader will
 * find it rather than left to the scan.
 *
 * UNLISTED-EXEMPT: the enumeration gate is the wrong predicate for a backup, in
 * the same way invariant 21 says it is the wrong predicate for a delete.
 * `personListableSql` decides whether a VIEWER may see that a Person exists;
 * there is no viewer here, only a file. Composing it would quietly omit every
 * unlisted Person from the backup — and then a restore would DELETE those
 * families from the directory, which is the "guard that silently skips its own
 * write" failure that invariant warns about, at its most expensive. The gate
 * this route actually needs is authority, and it is the system-admin check on
 * `GET /admin/backup`.
 */
async function readTable(env: Env, table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let after = 0;
  for (;;) {
    const page = await env.DB.prepare(
      `SELECT rowid AS __rowid, * FROM ${quoted(table)} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
    )
      .bind(after, PAGE)
      .all<Record<string, unknown>>();
    const rows = page.results;
    if (!rows.length) return out;
    for (const row of rows) {
      const { __rowid, ...rest } = row;
      after = Number(__rowid);
      out.push(rest);
    }
    if (rows.length < PAGE) return out;
  }
}

/** The whole database as one document. */
export async function exportBackup(env: Env): Promise<BackupDocument> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of await listBackupTables(env)) {
    tables[table] = await readTable(env, table);
  }
  return {
    format: BACKUP_FORMAT,
    generatedAt: nowIso(),
    school: env.SCHOOL_NAME,
    tables,
  };
}

export function countRows(doc: BackupDocument): BackupTableCount[] {
  return Object.entries(doc.tables)
    .map(([table, rows]) => ({ table, rows: rows.length }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

// ── Restore ─────────────────────────────────────────────────────────────────

export interface RestorePlan {
  /** What would be written, table by table. `audit_log` is reported with
   *  `skipped: true` rather than omitted, so the report says out loud that the
   *  log survives rather than leaving it to be noticed. */
  tables: { table: string; rows: number; skipped: boolean }[];
  totalRows: number;
  /** Refusals. A non-empty list means nothing is written, dry run or not. */
  errors: string[];
  /** Things an admin should read before confirming, none of which stop it. */
  warnings: string[];
}

/** Everything that can be decided before a single row is deleted.
 *
 *  The dry run and the real thing call this identically, and the real thing
 *  re-runs it rather than trusting what the client saw — the same shape
 *  `DELETE /admin/users/:id` uses for its impact report (invariant 17). It
 *  matters more here: a restore is not atomic across D1 batches, so validation
 *  failing half-way through would leave a half-erased directory. Everything
 *  that CAN fail is made to fail before the first DELETE.
 *
 *  @param actingAdminId the admin running the restore, so the report can warn
 *         them when the file does not contain their own account.
 */
export async function planRestore(
  env: Env,
  doc: unknown,
  actingAdminId: string,
): Promise<RestorePlan> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const empty: RestorePlan = { tables: [], totalRows: 0, errors, warnings };

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    errors.push("That doesn't look like a backup file.");
    return empty;
  }
  const backup = doc as Partial<BackupDocument>;
  if (backup.format !== BACKUP_FORMAT) {
    errors.push(
      `Backup format ${String(backup.format)} can't be restored by this version (expected ${BACKUP_FORMAT}).`,
    );
    return empty;
  }
  if (!backup.tables || typeof backup.tables !== "object" || Array.isArray(backup.tables)) {
    errors.push("The backup has no tables in it.");
    return empty;
  }

  const live = await listBackupTables(env);
  const liveSet = new Set(live);
  const fileTables = Object.keys(backup.tables);
  const skipped = new Set<string>(RESTORE_SKIPPED_TABLES);

  // A table the file names and this database doesn't have. Either the file came
  // from a NEWER schema, or it names something this route refuses to write
  // (EXCLUDED_TABLES). Both are refusals: restoring the rest would give a
  // directory that is silently missing whatever that table held.
  for (const table of fileTables) {
    if (!SAFE_IDENT.test(table)) {
      errors.push(`Unrecognised table name in the backup: ${table}`);
    } else if (!liveSet.has(table) && !skipped.has(table)) {
      errors.push(
        `The backup has a table this database can't restore: ${table}. ` +
          `It may have been taken from a newer version.`,
      );
    }
  }

  // …and the other direction. A live table the file never mentions would be
  // emptied by a whole-database restore, and emptying something nobody named is
  // the failure invariant 27 describes. So it refuses, and says how to mean it.
  for (const table of live) {
    if (!(table in backup.tables)) {
      errors.push(
        `The backup is missing "${table}", so restoring it would leave that table empty. ` +
          `It probably predates the migration that added it — add "${table}": [] to the file if that's what you want.`,
      );
    }
  }
  if (errors.length) return empty;

  const plan: RestorePlan["tables"] = [];
  let totalRows = 0;

  for (const table of fileTables) {
    const rows = backup.tables[table];
    if (!Array.isArray(rows)) {
      errors.push(`"${table}" isn't a list of rows.`);
      continue;
    }
    if (skipped.has(table)) {
      plan.push({ table, rows: rows.length, skipped: true });
      continue;
    }

    // Every key of every row has to be a real column. This is the schema-drift
    // check and the injection guard at once: column names are interpolated into
    // the INSERT (identifiers can't be bound), so nothing reaches a statement
    // that PRAGMA table_info didn't just hand back.
    const columns = new Set(await tableColumns(env, table));
    const unknown = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`"${table}" contains something that isn't a row.`);
        break;
      }
      for (const key of Object.keys(row)) if (!columns.has(key)) unknown.add(key);
    }
    for (const key of unknown) {
      errors.push(`"${table}" has a column this database doesn't: ${key}.`);
    }

    totalRows += rows.length;
    plan.push({ table, rows: rows.length, skipped: false });
  }

  if (totalRows > MAX_RESTORE_ROWS) {
    errors.push(`That backup has ${totalRows} rows, more than this can restore in one request.`);
  }

  // Never leave an instance nobody can administer. Same rule as the last-admin
  // guard on /admin/users/:id/disabled (invariant 17), reached from the other
  // direction: there the danger is disabling the last admin, here it is
  // restoring a file that never had one. Sessions are not restored, so an admin
  // the file DOES contain can always get back in with a fresh sign-in link.
  const users = backup.tables.user;
  if (Array.isArray(users)) {
    const admins = users.filter(
      (u) => u && typeof u === "object" && (u as Record<string, unknown>).is_system_admin === 1 &&
        ((u as Record<string, unknown>).disabled_at ?? null) === null,
    );
    if (!admins.length) {
      errors.push("That backup contains no enabled system admin, so restoring it would lock everyone out.");
    } else if (!admins.some((u) => (u as Record<string, unknown>).id === actingAdminId)) {
      warnings.push(
        "Your own account isn't an enabled admin in this backup — you'll be signed out of the console when it lands. Another admin in the file can still get in.",
      );
    }
  }

  warnings.push(
    "Sessions, sign-in links and pending invitations aren't restored. Anyone mid-invite will need a new link.",
  );
  warnings.push("Profile photos and newsletter images live in R2, not in this file, and aren't restored.");
  warnings.push("The audit log is never overwritten — this restore is appended to it.");

  if (errors.length) return { tables: [], totalRows: 0, errors, warnings };
  return { tables: plan, totalRows, errors, warnings };
}

/** The statements one table's restore is made of: empty it, then re-insert.
 *  Exported for the test, which asserts the shapes rather than trusting them. */
export function tableRestoreStmts(
  env: Env,
  table: string,
  rows: Record<string, unknown>[],
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [env.DB.prepare(`DELETE FROM ${quoted(table)}`)];
  for (const row of rows) {
    const cols = Object.keys(row);
    if (!cols.length) continue;
    const names = cols.map((c) => quoted(c)).join(", ");
    const holes = cols.map(() => "?").join(", ");
    stmts.push(
      env.DB.prepare(`INSERT INTO ${quoted(table)} (${names}) VALUES (${holes})`).bind(
        ...cols.map((c) => row[c] ?? null),
      ),
    );
  }
  return stmts;
}

/**
 * Execute a validated plan.
 *
 * Deletes come first, all of them, before any insert: D1 does not enforce
 * foreign keys (see CLAUDE.md, Conventions), so nothing here depends on order
 * for correctness — but doing it in two passes means a row can never be
 * inserted and then deleted by a later table's DELETE.
 *
 * NOT ATOMIC ACROSS CHUNKS. D1 wraps one `batch()` in a transaction, and a real
 * directory does not fit in one batch. That is exactly why `planRestore` runs
 * first and refuses on anything it can see: by the time this is called, the
 * remaining failure modes are the Worker dying and D1 being down.
 */
export async function runRestore(env: Env, doc: BackupDocument): Promise<number> {
  const skipped = new Set<string>(RESTORE_SKIPPED_TABLES);
  const tables = Object.keys(doc.tables).filter((t) => !skipped.has(t));

  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${quoted(t)}`)));

  let written = 0;
  for (const table of tables) {
    const rows = doc.tables[table] ?? [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      // tableRestoreStmts leads with the DELETE this pass already ran, so take
      // the inserts only.
      const stmts = tableRestoreStmts(env, table, chunk).slice(1);
      if (stmts.length) await env.DB.batch(stmts);
      written += stmts.length;
    }
  }
  return written;
}
