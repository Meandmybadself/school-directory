// The live bingo board, anonymously — the GET half of apps/bingo.
//
// Deliberately unauthenticated, the way routes/calendarPublic.ts and
// routes/volunteersPublic.ts are: no handler here calls requireAuth, and that
// absence IS the mechanism. The state is 75 numbers and which have been
// called — nothing names, identifies or contacts anyone — so the whole board
// crosses the seam. It is still built by `readBingoState`, field by field,
// so a column added to `bingo_state` later stays server-side until published
// on purpose.
//
// There is no write route here, and never will be: toggling or resetting the
// board needs a session (routes/bingo.ts) — not because the data is private,
// but because an open PUT would let anyone on the internet wipe the board
// mid-game.

import { Hono } from "hono";
import type { HonoEnv } from "../env.js";
import { readBingoState } from "../lib/bingo.js";

export const bingoPublic = new Hono<HonoEnv>();

/** GET /bingo-public/state — the board as it stands.
 *
 *  `no-store`: this is a live game that screens poll every few seconds, and a
 *  cached answer is a board showing the wrong ball. */
bingoPublic.get("/state", async (c) => {
  const state = await readBingoState(c.env);
  return c.json({ state }, 200, { "cache-control": "no-store" });
});
