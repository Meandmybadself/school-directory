// Moving an authored event carries its volunteer sheets onto the new date.
//
// This is the coupling that did NOT exist, and the production symptom is what
// this file is written against. A one-off event with an open sheet was moved two
// weeks later. `materialize` re-minted the occurrence at the new instant;
// `volunteer_sheet.occurrence_start` was never touched, so the sheet stayed on
// the old one — and because `publicEventOf`'s join is
// `vs.occurrence_start = e.starts_at`, the event's new page offered no sign-up
// link at all while eighteen families sat claimed on a date the calendar no
// longer produced. Nothing failed; a feature simply stopped existing.
//
// The tests are BEHAVIOURAL for the reason test/slackNotify.test.ts is: the fake
// D1 below records statements WITH THEIR BINDS, so an implementation that ran
// the right SQL against the wrong instant fails on the value rather than passing
// a scan. What is pinned:
//
//   · a sheet follows its occurrence, and everything dated off that occurrence —
//     `closes_at`, each position's shift window — moves by the same delta;
//   · a sheet already on a date the event still produces is left alone, so
//     extending a series doesn't churn the sheets it didn't affect;
//   · a series keeps ORDINALS, which is what carries every sheet forward when
//     the whole thing shifts;
//   · nothing is ever moved onto a date another sheet holds — `UNIQUE
//     (managed_event_id, occurrence_start)` would take the whole batch down
//     with it, and the sheet that is already right is not the one to disturb;
//   · an event with no sheets does none of this work.

import { describe, expect, it } from "vitest";
import { reanchorSheets } from "../src/lib/volunteers.js";
import type { Env } from "../src/env.js";

interface Stmt {
  sql: string;
  binds: unknown[];
}

interface SheetRow {
  id: string;
  slug: string;
  occurrence_start: string;
  closes_at: string | null;
}
interface PositionRow {
  id: string;
  sheet_id: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** A D1 stand-in that answers the three reads `reanchorSheets` makes and records
 *  every statement that reached `batch()` — the only place it writes. */
function fakeDb(rows: { sheets: SheetRow[]; positions?: PositionRow[]; signups?: Record<string, number> }) {
  const written: Stmt[] = [];
  const batches: Stmt[][] = [];
  const read: Stmt[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        const stmt = {
          sql,
          binds: [] as unknown[],
          bind(...binds: unknown[]) {
            this.binds = binds;
            return this;
          },
          async all() {
            read.push({ sql, binds: this.binds });
            if (sql.includes("FROM volunteer_sheet")) return { results: rows.sheets };
            if (sql.includes("FROM volunteer_position")) {
              const ids = new Set(this.binds as string[]);
              return { results: (rows.positions ?? []).filter((p) => ids.has(p.sheet_id)) };
            }
            if (sql.includes("FROM volunteer_signup")) {
              const ids = new Set(this.binds as string[]);
              return {
                results: Object.entries(rows.signups ?? {})
                  .filter(([sheetId]) => ids.has(sheetId))
                  .map(([sheet_id, n]) => ({ sheet_id, n })),
              };
            }
            return { results: [] };
          },
        };
        return stmt;
      },
      async batch(stmts: Stmt[]) {
        const group = stmts.map((s) => ({ sql: s.sql, binds: s.binds }));
        batches.push(group);
        written.push(...group);
        return stmts.map(() => ({ meta: { changes: 1 } }));
      },
    },
  } as unknown as Env;
  return { env, written, batches, read };
}

/** Every write against `table`, as {binds} — what actually reached the database. */
const writesTo = (written: Stmt[], table: string) =>
  written.filter((s) => s.sql.includes(`UPDATE ${table}`));

const SEP25 = "2026-09-25T12:30:00.000Z";
const OCT9 = "2026-10-09T12:30:00.000Z";
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

describe("reanchorSheets", () => {
  it("moves a one-off event's sheet, its close date and its shift windows by the same delta", async () => {
    // The production case: Field Day, two positions ("Morning Games",
    // "Midday Games"), moved from Sep 25 to Oct 9.
    const { env, written } = fakeDb({
      sheets: [{ id: "01SHEET", slug: "field-day-2026-09-25", occurrence_start: SEP25, closes_at: "2026-09-24T05:00:00.000Z" }],
      positions: [
        { id: "01POS1", sheet_id: "01SHEET", starts_at: SEP25, ends_at: "2026-09-25T16:00:00.000Z" },
        { id: "01POS2", sheet_id: "01SHEET", starts_at: "2026-09-25T15:30:00.000Z", ends_at: "2026-09-25T19:00:00.000Z" },
      ],
      signups: { "01SHEET": 18 },
    });

    const { moves, stranded } = await reanchorSheets(env, "01EVENT", [SEP25], [OCT9]);

    expect(stranded).toBe(0);
    expect(moves).toEqual([
      { id: "01SHEET", slug: "field-day-2026-09-25", from: SEP25, to: OCT9, signups: 18 },
    ]);

    const [sheet] = writesTo(written, "volunteer_sheet");
    // occurrence_start, then closes_at — both fourteen days later.
    expect(sheet!.binds[0]).toBe(OCT9);
    expect(sheet!.binds[1]).toBe("2026-10-08T05:00:00.000Z");

    // BOTH positions, which is the half of this the bug report noticed: one
    // group moving and the other not is exactly what a per-sheet fix that
    // forgot the positions would produce.
    const positions = writesTo(written, "volunteer_position");
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      const [startsAt, endsAt] = p.binds as [string, string];
      const original = p.binds[3] === "01POS1" ? SEP25 : "2026-09-25T15:30:00.000Z";
      expect(new Date(startsAt).getTime() - new Date(original).getTime()).toBe(FOURTEEN_DAYS);
      // The shift keeps its own length, not just its start.
      expect(new Date(endsAt).getTime() - new Date(startsAt).getTime()).toBe(3.5 * 60 * 60 * 1000);
    }
  });

  it("leaves a sheet alone when its date survived the edit", async () => {
    // Extending a weekly series' UNTIL adds dates and moves none. A sheet on one
    // of the dates that stayed is already where it belongs, and rewriting it
    // would churn `updated_at` and the shift windows for nothing.
    const week2 = "2026-10-02T12:30:00.000Z";
    const { env, written } = fakeDb({
      sheets: [{ id: "01SHEET", slug: "s", occurrence_start: week2, closes_at: null }],
      positions: [{ id: "01POS", sheet_id: "01SHEET", starts_at: week2, ends_at: null }],
    });

    const { moves, stranded } = await reanchorSheets(
      env,
      "01EVENT",
      [SEP25, week2],
      [SEP25, week2, "2026-10-09T12:30:00.000Z"],
    );

    expect(moves).toEqual([]);
    expect(stranded).toBe(0);
    expect(written).toEqual([]);
  });

  it("keeps ordinals when a whole series shifts", async () => {
    const oldStarts = ["2026-09-25T12:30:00.000Z", "2026-10-02T12:30:00.000Z", "2026-10-09T12:30:00.000Z"];
    // The same three dates, an hour later.
    const newStarts = oldStarts.map((s) => new Date(new Date(s).getTime() + 3600_000).toISOString());
    const { env, written } = fakeDb({
      sheets: [
        { id: "01FIRST", slug: "a", occurrence_start: oldStarts[0]!, closes_at: null },
        { id: "01THIRD", slug: "c", occurrence_start: oldStarts[2]!, closes_at: null },
      ],
    });

    const { moves } = await reanchorSheets(env, "01EVENT", oldStarts, newStarts);

    expect(moves.map((m) => [m.id, m.to])).toEqual([
      ["01FIRST", newStarts[0]],
      ["01THIRD", newStarts[2]],
    ]);
    expect(writesTo(written, "volunteer_sheet")).toHaveLength(2);
  });

  it("puts an already-orphaned sheet back on a one-date event", async () => {
    // The clause that heals what the missing coupling left behind: the sheet's
    // instant is in NEITHER list, and a one-date event has nowhere else to put
    // it. This is what makes a stranded sheet recover on its event's next save
    // rather than needing a hand-written UPDATE.
    const { env } = fakeDb({
      sheets: [{ id: "01SHEET", slug: "s", occurrence_start: "2026-08-01T12:30:00.000Z", closes_at: null }],
    });
    const { moves } = await reanchorSheets(env, "01EVENT", [SEP25], [OCT9]);
    expect(moves.map((m) => m.to)).toEqual([OCT9]);
  });

  it("never moves a sheet onto a date another sheet already holds", async () => {
    // `UNIQUE (managed_event_id, occurrence_start)` would reject the batch and
    // take the correct sheet's write down with it. The orphan stays orphaned,
    // which is what the admin screen's banner is for.
    const { env, written } = fakeDb({
      sheets: [
        { id: "01ORPHAN", slug: "orphan", occurrence_start: "2026-08-01T12:30:00.000Z", closes_at: null },
        { id: "01RIGHT", slug: "right", occurrence_start: OCT9, closes_at: null },
      ],
    });
    const { moves, stranded } = await reanchorSheets(env, "01EVENT", [SEP25], [OCT9]);
    expect(moves).toEqual([]);
    // Reported, not just skipped — a sheet nobody moved is sign-ups nobody can
    // find, and the admin hears about it.
    expect(stranded).toBe(1);
    expect(written).toEqual([]);
  });

  it("refuses the ordinal when the series was cut rather than shifted", async () => {
    // Weekly Oct 1/8/15/22, one sheet on Oct 1. The admin drops the first date
    // by moving the start to Oct 8. An unguarded ordinal maps Oct 1 -> Oct 8 and
    // carries eighteen families onto an occurrence that existed before the edit
    // and nothing about the edit touched. Same count in and out is the test for
    // a translation; four-into-three is not one.
    const week = (d: number) => `2026-10-${String(d).padStart(2, "0")}T12:30:00.000Z`;
    const { env, written } = fakeDb({
      sheets: [{ id: "01SHEET", slug: "s", occurrence_start: week(1), closes_at: null }],
      signups: { "01SHEET": 18 },
    });

    const { moves, stranded } = await reanchorSheets(
      env,
      "01EVENT",
      [week(1), week(8), week(15), week(22)],
      [week(8), week(15), week(22)],
    );

    expect(moves).toEqual([]);
    expect(stranded).toBe(1);
    expect(written).toEqual([]);
  });

  it("keeps each sheet's own positions in the same batch as its move", async () => {
    // A `batch()` is atomic; a sequence of them is not. A boundary falling
    // between a sheet's new date and its positions' shift windows leaves the
    // shifts on the old day, and the delta that would repair them lives only in
    // the memory of the request that already returned.
    const sheets = Array.from({ length: 4 }, (_, i) => ({
      id: `01SHEET${i}`,
      slug: `s${i}`,
      occurrence_start: `2026-10-${String(i * 7 + 1).padStart(2, "0")}T12:30:00.000Z`,
      closes_at: null,
    }));
    const positions = sheets.flatMap((s) =>
      // 40 apiece, so four sheets cannot fit in one 100-statement batch.
      Array.from({ length: 40 }, (_, j) => ({
        id: `${s.id}P${j}`,
        sheet_id: s.id,
        starts_at: s.occurrence_start,
        ends_at: null,
      })),
    );
    const { env, batches } = fakeDb({ sheets, positions });

    const oldStarts = sheets.map((s) => s.occurrence_start);
    const newStarts = oldStarts.map((s) => new Date(new Date(s).getTime() + 3600_000).toISOString());
    const { moves } = await reanchorSheets(env, "01EVENT", oldStarts, newStarts);
    expect(moves).toHaveLength(4);
    // More than one batch, and no sheet split across two of them.
    expect(batches.length).toBeGreaterThan(1);
    for (const sheet of sheets) {
      const touching = batches.filter((b) => b.some((st) => st.binds.includes(sheet.id) || st.binds.some((v) => typeof v === "string" && v.startsWith(`${sheet.id}P`))));
      expect(touching).toHaveLength(1);
    }
  });

  it("writes nothing for an event with no sheets", async () => {
    const { env, written, read } = fakeDb({ sheets: [] });
    expect(await reanchorSheets(env, "01EVENT", [SEP25], [OCT9])).toEqual({ moves: [], stranded: 0 });
    expect(written).toEqual([]);
    // One read to find out there was nothing to do, and no second one.
    expect(read).toHaveLength(1);
  });
});
