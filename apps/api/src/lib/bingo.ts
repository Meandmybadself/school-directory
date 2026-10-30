// The bingo board's one row of shared state (migration 0040).
//
// Both routers read through `readBingoState`, which is also the public seam:
// the DTO is hand-built field by field like `publicEventOf` and its siblings,
// so a column added to `bingo_state` later stays server-side until someone
// publishes it on purpose. There is nothing private in the row TODAY — the
// game is 75 numbers — but the habit is the guarantee, not the contents.

import type { BingoStateDTO } from "@sd/shared";
import type { Env } from "../env.js";
import { nowIso } from "./time.js";

/** The single row. One school, one game at a time. */
const BOARD_ID = "board";

/** A called ball: an integer on the 75-ball board. */
export function isBingoNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 75;
}

/** What a PUT may replace the board with. Validated, never trusted:
 *  out-of-range or non-integer numbers refuse the whole write (a 400, not a
 *  silently narrowed board — invariant 18's "never a dropped term" posture),
 *  duplicates collapse to their first appearance (a double-tap is a client
 *  hiccup, not a different game), and the displayed ball must be one that was
 *  actually called. */
export function normalizeBingoInput(
  body: unknown,
): { markedNumbers: number[]; currentNumber: number | null } | null {
  if (!body || typeof body !== "object") return null;
  const { markedNumbers, currentNumber } = body as {
    markedNumbers?: unknown;
    currentNumber?: unknown;
  };
  if (!Array.isArray(markedNumbers) || markedNumbers.length > 75) return null;
  const marked: number[] = [];
  for (const n of markedNumbers) {
    if (!isBingoNumber(n)) return null;
    if (!marked.includes(n)) marked.push(n);
  }
  if (currentNumber === null || currentNumber === undefined) {
    return { markedNumbers: marked, currentNumber: null };
  }
  if (!isBingoNumber(currentNumber) || !marked.includes(currentNumber)) return null;
  return { markedNumbers: marked, currentNumber };
}

/** The board as anyone may see it. A missing row — before the first game — is
 *  an empty board, not an error; so is a row whose JSON has somehow rotted
 *  (the parse failing must not take the public GET down mid-game). */
export async function readBingoState(env: Env): Promise<BingoStateDTO> {
  const row = await env.DB.prepare(
    "SELECT marked_numbers, current_number, updated_at FROM bingo_state WHERE id = ?",
  )
    .bind(BOARD_ID)
    .first<{ marked_numbers: string; current_number: number | null; updated_at: string }>();
  if (!row) return { markedNumbers: [], currentNumber: null, updatedAt: null };

  let marked: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.marked_numbers);
    if (Array.isArray(parsed)) marked = parsed.filter(isBingoNumber);
  } catch {
    // Treat unparseable state as an empty board; the next write repairs it.
  }
  const current = isBingoNumber(row.current_number) && marked.includes(row.current_number)
    ? row.current_number
    : null;
  return { markedNumbers: marked, currentNumber: current, updatedAt: row.updated_at };
}

/** Same game? Order matters — the call order is part of the state (it is what
 *  distinguishes "unmarked and re-marked" from "untouched"). */
export function sameBingoState(
  a: { markedNumbers: number[]; currentNumber: number | null },
  b: { markedNumbers: number[]; currentNumber: number | null },
): boolean {
  return (
    a.currentNumber === b.currentNumber &&
    a.markedNumbers.length === b.markedNumbers.length &&
    a.markedNumbers.every((n, i) => b.markedNumbers[i] === n)
  );
}

/** Replace the board. Last-write-wins over the whole row — one operator with a
 *  touchscreen, and losing a race costs one tap, re-tappable. */
export async function writeBingoState(
  env: Env,
  state: { markedNumbers: number[]; currentNumber: number | null },
): Promise<string> {
  const updatedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO bingo_state (id, marked_numbers, current_number, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       marked_numbers = excluded.marked_numbers,
       current_number = excluded.current_number,
       updated_at = excluded.updated_at`,
  )
    .bind(BOARD_ID, JSON.stringify(state.markedNumbers), state.currentNumber, updatedAt)
    .run();
  return updatedAt;
}
