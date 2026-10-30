-- 0040_bingo.sql — the bingo board's one row of shared state.
--
-- bingo.eisenhower.school (apps/bingo) is the Trilingual Bingo Night board:
-- numbers are toggled as balls are pulled, and the screen at the front of the
-- gym is the game's state. This row is that state, server-side, so a refresh,
-- a crashed tablet or a second screen picks the game straight back up — the
-- original app kept it in localStorage and one device owned the truth.
--
-- The whole game is 75 numbers and which of them have been called. Nothing
-- here names, identifies or contacts anyone, which is what lets the read be
-- public (routes/bingoPublic.ts, a hand-written projection like its siblings).
-- Writes need a session (routes/bingo.ts) — not because the data is private,
-- but because an open PUT would let anyone on the internet wipe the board
-- mid-game.
--
-- One row, keyed 'board': a single-tenant school runs one game at a time, and
-- last-write-wins over the whole state is the right concurrency model for one
-- operator with a touchscreen (invariant 28's `position` reasoning, smaller).
-- No REFERENCES user(id) on purpose — attribution lives in audit_log, and a
-- column here would oblige userDeletionStmts (invariant 17) to care about a
-- bingo game.
CREATE TABLE bingo_state (
  id TEXT PRIMARY KEY,
  marked_numbers TEXT NOT NULL, -- JSON array of integers 1..75, in call order
  current_number INTEGER,       -- the ball on display; always one of marked_numbers
  updated_at TEXT NOT NULL
);
