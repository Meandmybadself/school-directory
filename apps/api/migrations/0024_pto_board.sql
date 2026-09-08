-- 0024_pto_board.sql — the PTO's own planning boards: a board per event or
-- initiative, columns down it, cards in the columns, and directory Persons
-- assigned to the cards.
--
-- WHY THIS EXISTS. The PTO's operating knowledge turns over with the board every
-- October and lives, until now, in one person's head or a Google Doc that gets
-- re-typed each year. `volunteer_sheet` (migration 0012) already answers "who is
-- bringing the cooler on the day"; nothing here answers "who is chasing the
-- vendor in the six weeks before it". These tables are that second question.
--
-- WHO MAY SEE ANY OF IT. Everything in this file is MEMBERS-AND-PTO-BOARD only.
-- There is deliberately NO public projection of any `pto_*` table anywhere in
-- the codebase and no `/pto-public/*` router — compare `volunteer_sheet`, whose
-- whole design turns on a public/private split, and note that this is the
-- opposite choice made on purpose. A board carries vendor notes, money, and
-- half-finished opinions about how an event went; none of that is a thing the
-- open internet gets, and the cheapest way to guarantee it is for the public
-- seam not to exist. The gate itself is `ptoAccess` in lib/ptoBoard.ts, keyed on
-- the group named by the `pto_board_group_id` setting — no schema change needed
-- for that, it is a row in `setting`.
--
-- POSITION IS A REAL, NOT AN INTEGER. Every ordered thing here (boards, lists,
-- cards) sorts on a float, and a drag inserts at the midpoint between its new
-- neighbours. That makes a move ONE `UPDATE` of one row instead of a renumber of
-- the whole column, which matters because D1 has no transaction: a renumber is a
-- read-then-write over N rows and two people dragging at once would interleave
-- into a scrambled column. A midpoint write cannot scramble anything — the worst
-- concurrent outcome is that one card lands where the other person didn't expect,
-- which is what a shared board looks like anyway.
--
-- This is the one place in this codebase where LAST WRITE WINS is the right
-- answer rather than a bug. Contrast the guarded `INSERT … WHERE (count < slots)`
-- in lib/volunteers.ts: overfilling a volunteer position promises a shift to two
-- people, so losing that race has to be detected. Nothing is over-committed by
-- losing a drag race, and a compare-and-swap there would only make a card snap
-- back under someone's cursor. Floats do run out of precision after enough
-- midpoint insertions between the same pair, so `normalizePositions` in
-- lib/ptoBoard.ts rewrites a column to whole numbers when the gap gets small.
--
-- CARDS CARRY `board_id` AS WELL AS `list_id`, which is a denormalization and is
-- deliberate: every read and every authorization check in routes/pto.ts is
-- board-scoped ("may this caller touch this board?"), so carrying the board on
-- the card turns that check into a column read instead of a join through
-- `pto_list` on the hot path. A move between columns writes both, in one
-- statement, so the two can never disagree.

-- A board is one event or one initiative — "Read-A-Thon 2026", "Playground
-- fund", "Fall conferences". `slug` is what the URL carries (/b/:slug); it is
-- members-only, so unlike a volunteer sheet's slug it is not an enumerable
-- public handle and nothing follows from guessing it.
CREATE TABLE pto_board (
  id               TEXT PRIMARY KEY,                    -- ULID
  slug             TEXT NOT NULL UNIQUE,
  title            TEXT NOT NULL,
  summary          TEXT,                                -- one line under the title
  -- Optional link to the calendar. References `managed_event`, NEVER
  -- `calendar_event`: the latter is a derived cache whose row ids are re-minted
  -- on every re-materialization (invariant 8), so it is not a durable handle.
  -- The board stores NO date of its own — it reads the series and shows the next
  -- occurrence, because a date copied here is wrong the moment the school moves
  -- the event, which is the same reasoning apps/home applies to its events block.
  managed_event_id TEXT REFERENCES managed_event(id),
  position         REAL NOT NULL DEFAULT 0,
  archived_at      TEXT,                                -- soft: last year's board is worth keeping
  created_by       TEXT REFERENCES user(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- A column. Named `pto_list` rather than `pto_column` because `column` is a
-- reserved word in SQLite, the same reason `grp` is not `group`.
CREATE TABLE pto_list (
  id         TEXT PRIMARY KEY,                          -- ULID
  board_id   TEXT NOT NULL REFERENCES pto_board(id),
  title      TEXT NOT NULL,
  position   REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pto_card (
  id          TEXT PRIMARY KEY,                         -- ULID
  board_id    TEXT NOT NULL REFERENCES pto_board(id),   -- denormalized; see header
  list_id     TEXT NOT NULL REFERENCES pto_list(id),
  title       TEXT NOT NULL,
  description TEXT,
  due_at      TEXT,                                     -- ISO-8601 UTC, optional
  position    REAL NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_by  TEXT REFERENCES user(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Who is doing it. `person_id`, not `user_id`, so the board addresses the same
-- identity the rest of this system does — the directory Person — and a card can
-- name someone who has never signed in. `assigned_by` is the User who did the
-- assigning, which is the only reason the two columns differ; the same split
-- `volunteer_signup` makes between the Person volunteering and the account that
-- claimed the spot.
--
-- Reading a name off this table always goes through `ptoRosterOf`, which
-- composes `personListableSql` (invariant 21). An unlisted Person's row simply
-- doesn't come back, and the card renders a generic label instead — the answer
-- `personLabel` gives in lib/slackNotify.ts, for the same reason: reporting a
-- withheld Person and a nonexistent one identically is what stops the response
-- becoming an oracle for the flag.
CREATE TABLE pto_card_assignee (
  card_id     TEXT NOT NULL REFERENCES pto_card(id),
  person_id   TEXT NOT NULL REFERENCES person(id),
  assigned_by TEXT REFERENCES user(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (card_id, person_id)
);

-- Discussion on a card. `author_user_id` and not a Person: a comment is speech
-- by an account, and unlike a volunteer signup there is no case where one member
-- writes on another's behalf.
CREATE TABLE pto_card_comment (
  id             TEXT PRIMARY KEY,                      -- ULID
  card_id        TEXT NOT NULL REFERENCES pto_card(id),
  author_user_id TEXT NOT NULL REFERENCES user(id),
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

-- Labels are per-board, not global: "Needs a vendor" means something on the
-- Read-A-Thon board and nothing on the playground one. `color` is a token NAME
-- from a small fixed palette the client maps to CSS variables, never a hex
-- value — a stored `#fff` would be the one thing in the design system that
-- couldn't answer to dark mode.
CREATE TABLE pto_label (
  id       TEXT PRIMARY KEY,                            -- ULID
  board_id TEXT NOT NULL REFERENCES pto_board(id),
  name     TEXT NOT NULL,
  color    TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0
);

CREATE TABLE pto_card_label (
  card_id  TEXT NOT NULL REFERENCES pto_card(id),
  label_id TEXT NOT NULL REFERENCES pto_label(id),
  PRIMARY KEY (card_id, label_id)
);

CREATE INDEX idx_pto_list_board       ON pto_list (board_id, position);
CREATE INDEX idx_pto_card_board       ON pto_card (board_id, position);
CREATE INDEX idx_pto_card_list        ON pto_card (list_id, position);
CREATE INDEX idx_pto_assignee_person  ON pto_card_assignee (person_id);
CREATE INDEX idx_pto_comment_card     ON pto_card_comment (card_id, created_at);
CREATE INDEX idx_pto_label_board      ON pto_label (board_id, position);
CREATE INDEX idx_pto_board_event      ON pto_board (managed_event_id);
