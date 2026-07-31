-- 0012_volunteers.sql — Volunteer signups on calendar events. A sheet of
-- positions ("snack table, 4 people, 5–7pm") hung off ONE occurrence of an
-- authored event, which members claim spots on as one of the Persons they
-- control.
--
-- This is the feature migration 0009 reserved room for. Read that file's header
-- first: a calendar_event row gets a fresh ULID on every re-materialization, so
-- its id is NOT a durable handle. A sheet therefore keys on
-- (managed_event_id, occurrence_start) — the ICS UID + RECURRENCE-ID pair —
-- exactly as 0009 said a signup would, and NOTHING here references
-- calendar_event at all. Reading a sheet joins managed_event for the title and
-- location; the derived cache is used only to tell an admin that an occurrence
-- they opened has since been edited away.
--
-- Only MANAGED events can carry signups, and that is a consequence rather than
-- a policy: an imported ICS event has no durable id to attach one to.
--
-- Public/private split (see CLAUDE.md invariants 1 and 12): a sheet's URL is its
-- `slug`, which is public and enumerable in the same way a newsletter issue's
-- is. Anonymous readers get positions and FILLED COUNTS; who filled them is a
-- member-only read, enforced in lib/volunteers.ts's publicSheetOf, never here.
-- Nothing in these tables may be assumed private just because a column exists.
--
-- Overfill is prevented by a guarded INSERT ... SELECT ... WHERE (count < slots)
-- in lib/volunteers.ts rather than a constraint — SQLite can't express "at most
-- `slots` rows per position" declaratively, and a single statement is atomic in
-- D1 where a read-then-write is not.

CREATE TABLE volunteer_sheet (
  id               TEXT PRIMARY KEY,                       -- ULID
  managed_event_id TEXT NOT NULL REFERENCES managed_event(id),
  occurrence_start TEXT NOT NULL,                          -- ISO-8601 UTC; the RECURRENCE-ID half
  slug             TEXT NOT NULL UNIQUE,                   -- public URL, e.g. "fall-carnival-2026-10-17"
  intro            TEXT,                                   -- optional blurb above the positions
  published_at     TEXT,                                   -- NULL = draft; the public route 404s on it
  closes_at        TEXT,                                   -- optional; claims refused at/after this
  created_by       TEXT REFERENCES user(id),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- One sheet per occurrence. Two sheets on the same date would make "the"
  -- volunteer link for an event ambiguous everywhere it's surfaced.
  UNIQUE (managed_event_id, occurrence_start)
);

-- The "group" of the product request: a job, how many people it takes, and
-- optionally the slice of the event they're needed for. starts_at/ends_at are
-- independent of the event's own times on purpose — a shift can be shorter than
-- the event (5–7pm of a 4–9pm carnival) — and are display-only; nothing
-- schedules off them.
CREATE TABLE volunteer_position (
  id          TEXT PRIMARY KEY,                            -- ULID
  sheet_id    TEXT NOT NULL REFERENCES volunteer_sheet(id),
  title       TEXT NOT NULL,
  description TEXT,
  slots       INTEGER NOT NULL DEFAULT 1,                  -- how many people are needed
  starts_at   TEXT,                                        -- ISO-8601 UTC, optional timeframe
  ends_at     TEXT,                                        -- ISO-8601 UTC, optional timeframe
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (slots >= 1)
);

-- person_id is who is volunteering; user_id is the account that made the claim.
-- They differ whenever a parent signs up a child, and both are needed: the
-- Person is what gets displayed, the User is who may withdraw it. A signup is
-- never anonymous — claiming requires a session (there is no public write path).
CREATE TABLE volunteer_signup (
  id          TEXT PRIMARY KEY,                            -- ULID
  position_id TEXT NOT NULL REFERENCES volunteer_position(id),
  person_id   TEXT NOT NULL REFERENCES person(id),
  user_id     TEXT NOT NULL REFERENCES user(id),           -- the controller who claimed it
  note        TEXT,                                        -- "I'll bring the cooler"
  created_at  TEXT NOT NULL,
  -- One spot per Person per position. Someone wanting two spots takes a spot on
  -- two positions, or the admin raises `slots`.
  UNIQUE (position_id, person_id)
);

CREATE INDEX idx_volunteer_sheet_event    ON volunteer_sheet (managed_event_id, occurrence_start);
CREATE INDEX idx_volunteer_position_sheet ON volunteer_position (sheet_id, sort_order);
CREATE INDEX idx_volunteer_signup_pos     ON volunteer_signup (position_id);
CREATE INDEX idx_volunteer_signup_person  ON volunteer_signup (person_id);
