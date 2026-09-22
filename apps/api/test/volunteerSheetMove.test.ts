// Moving an orphaned sheet by hand — the repair `reanchorSheets` can't do.
//
// The automatic re-anchor deliberately refuses to guess: a series truncated
// rather than translated, or one that genuinely lost a date, leaves a sheet
// stranded and SAYS so. Before this existed the admin screen then offered
// nothing but a delete, which for a sheet like Field Day's meant discarding
// eighteen families' sign-ups in order to fix a date.
//
// What is pinned here is the narrowness, because that narrowness is the whole
// reason `VolunteerSheetInput.occurrenceStart` can stay create-only while this
// exists: the target must be a date the event ACTUALLY produces (read from the
// materialized agenda, not taken on the client's word) and must not already
// hold a sheet. Behavioural, like its sibling: the fake D1 records statements
// with their binds, so a guard that ran the write anyway fails on a statement.

import { describe, expect, it } from "vitest";
import { moveSheet, VolunteerError } from "../src/lib/volunteers.js";
import type { Env } from "../src/env.js";

const SEP25 = "2026-09-25T12:30:00.000Z";
const OCT9 = "2026-10-09T12:30:00.000Z";

interface Stmt {
  sql: string;
  binds: unknown[];
}

function fakeDb(opts: { sheet?: boolean; occurrence?: boolean; clash?: boolean } = {}) {
  const { sheet = true, occurrence = true, clash = false } = opts;
  const written: Stmt[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          sql,
          binds: [] as unknown[],
          bind(...binds: unknown[]) {
            this.binds = binds;
            return this;
          },
          async first() {
            if (sql.includes("FROM volunteer_sheet WHERE id")) {
              return sheet
                ? {
                    id: "01SHEET",
                    slug: "field-day-2026-09-25",
                    managed_event_id: "01EVENT",
                    occurrence_start: SEP25,
                    closes_at: null,
                  }
                : null;
            }
            if (sql.includes("FROM calendar_event")) return occurrence ? { id: "01OCC" } : null;
            if (sql.includes("AND id <> ?")) return clash ? { id: "01OTHER" } : null;
            if (sql.includes("COUNT(*) AS n")) return { n: 18 };
            return null;
          },
          async all() {
            if (sql.includes("FROM volunteer_position")) {
              return {
                results: [
                  { id: "01POS1", starts_at: SEP25, ends_at: "2026-09-25T16:00:00.000Z" },
                  { id: "01POS2", starts_at: "2026-09-25T15:30:00.000Z", ends_at: "2026-09-25T19:00:00.000Z" },
                ],
              };
            }
            return { results: [] };
          },
        };
      },
      async batch(stmts: Stmt[]) {
        for (const s of stmts) written.push({ sql: s.sql, binds: s.binds });
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
  return { env, written };
}

describe("moveSheet", () => {
  it("moves the sheet and both positions in ONE batch", async () => {
    const { env, written } = fakeDb();
    const result = await moveSheet(env, "01SHEET", OCT9);

    expect(result?.move).toMatchObject({ from: SEP25, to: OCT9, signups: 18 });
    // Three statements — the sheet and its two positions — and all of them in
    // the same batch, so a sheet can never land on the new date with its shift
    // windows left on the old one.
    expect(written).toHaveLength(3);
    expect(written[0]!.binds[0]).toBe(OCT9);
    const shifted = written.slice(1).map((s) => s.binds[0]);
    expect(shifted).toEqual(["2026-10-09T12:30:00.000Z", "2026-10-09T15:30:00.000Z"]);
  });

  it("refuses a date the event doesn't actually have", async () => {
    // The client offers only real dates, which is exactly why the server may
    // not rely on it: this is the guard that stops a hand-made request parking
    // a sheet — and its sign-ups — on a day nothing will ever render.
    const { env, written } = fakeDb({ occurrence: false });
    await expect(moveSheet(env, "01SHEET", OCT9)).rejects.toBeInstanceOf(VolunteerError);
    expect(written).toEqual([]);
  });

  it("refuses a date that already has a sheet", async () => {
    // UNIQUE (managed_event_id, occurrence_start) would reject it anyway; this
    // turns a 500 into a sentence, and keeps "the" volunteer link for a date
    // unambiguous.
    const { env, written } = fakeDb({ clash: true });
    await expect(moveSheet(env, "01SHEET", OCT9)).rejects.toBeInstanceOf(VolunteerError);
    expect(written).toEqual([]);
  });

  it("writes nothing when the sheet is already on that date", async () => {
    // A double-tap must not pad an append-only log (invariants 27 and 28), so
    // `move` is null and the route pushes no draft.
    const { env, written } = fakeDb();
    const result = await moveSheet(env, "01SHEET", SEP25);
    expect(result?.move).toBeNull();
    expect(written).toEqual([]);
  });

  it("is null for a sheet that doesn't exist", async () => {
    const { env, written } = fakeDb({ sheet: false });
    expect(await moveSheet(env, "01NOPE", OCT9)).toBeNull();
    expect(written).toEqual([]);
  });
});
