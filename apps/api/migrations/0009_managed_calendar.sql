-- 0009_managed_calendar.sql — "managed" calendars: created and edited directly
-- in the calendar app, as opposed to 0006's calendars imported from an external
-- ICS URL. A managed calendar also PUBLISHES a feed (GET /ics/:id.ics) so it can
-- be subscribed to from Google/Apple Calendar.
--
-- Occurrences materialize into the EXISTING calendar_event table via nullable
-- discriminator columns, so GET /calendar/events, dedupeEvents and the
-- show/hide filter keep a single read path — calendar_source.id is simply
-- generalized to COALESCE(source_id, managed_calendar_id) as the "feed id".
-- This mirrors 0006's split exactly: calendar_source is the master row for an
-- imported feed, managed_event is the master row for an authored event, and
-- calendar_event is the materialized read model for both.
--
-- Stable identity: a calendar_event row gets a fresh ULID on every
-- re-materialization, so its id is NOT a durable handle. A managed occurrence is
-- identified by (managed_event_id, starts_at) — the ICS UID + RECURRENCE-ID
-- convention. managed_event.id is created once and only ever UPDATEd, never
-- replaced, so that pair survives re-materialization. This is the key a future
-- volunteer-signup feature attaches to; a signup row would reference
-- (managed_event_id, starts_at), never a disposable calendar_event.id.
--
-- created_by is recorded now but not yet used for authorization — create/edit/
-- delete is system-admin-only — so per-calendar editor delegation can be added
-- later without a schema rewrite.

CREATE TABLE managed_calendar (
  id          TEXT PRIMARY KEY,                 -- ULID
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#0068A8',  -- hex, for the event tag (same convention as calendar_source)
  description TEXT,
  created_by  TEXT REFERENCES user(id),         -- extension point: editor delegation
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- The editable master row for one event and its recurrence rule. Recurrence is
-- stored structured (not as an RRULE string): lib/icsWriter.ts derives the RRULE
-- line from these columns, and lib/managedCalendar.ts materializes occurrences
-- by parsing that same generated ICS back through lib/calendar.ts's parseIcs —
-- so the published feed and the in-app agenda cannot disagree.
CREATE TABLE managed_event (
  id           TEXT PRIMARY KEY,                -- ULID; durable series id, also the ICS UID base
  calendar_id  TEXT NOT NULL REFERENCES managed_calendar(id),
  title        TEXT NOT NULL,
  location     TEXT,
  description  TEXT,
  starts_at    TEXT NOT NULL,                   -- ISO-8601 UTC; the series DTSTART
  ends_at      TEXT,                            -- ISO-8601 UTC, null allowed. For all-day events
                                                --   this is the RFC5545-exclusive day AFTER the last
                                                --   day, never the inclusive last day an admin picked
  all_day      INTEGER NOT NULL DEFAULT 0,
  recur_freq   TEXT,                            -- NULL (one-off) | daily | weekly | monthly
  recur_interval INTEGER NOT NULL DEFAULT 1,    -- every N days/weeks/months
  recur_byday  TEXT,                            -- weekly only: comma list, e.g. "MO,WE,FR"
  recur_until  TEXT,                            -- required when recur_freq is set; ISO-8601 UTC.
                                                --   Bounding every rule keeps expansion finite, so
                                                --   occurrences are materialized once on write with
                                                --   no cron needed to slide a window forward
  sequence     INTEGER NOT NULL DEFAULT 0,      -- RFC5545 SEQUENCE; bumped on each edit so
                                                --   subscribed clients know to re-pull
  created_by   TEXT REFERENCES user(id),        -- extension point: editor delegation
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (recur_freq IS NULL OR recur_freq IN ('daily','weekly','monthly')),
  CHECK (recur_freq IS NULL OR recur_until IS NOT NULL),
  CHECK (recur_byday IS NULL OR recur_freq = 'weekly'),
  CHECK (recur_interval >= 1)
);

CREATE INDEX idx_managed_event_calendar ON managed_event (calendar_id);

-- calendar_event gains the managed discriminators. source_id must become
-- nullable, which SQLite can only do by rebuilding the table. This is a derived
-- cache — the cron refresh rewrites every imported row every 3 hours anyway — so
-- the copy below is belt-and-braces rather than load-bearing.
CREATE TABLE calendar_event_new (
  id                  TEXT PRIMARY KEY,                        -- ULID; NOT stable across refreshes
  source_id           TEXT REFERENCES calendar_source(id),     -- set for imported rows
  managed_calendar_id TEXT REFERENCES managed_calendar(id),    -- set for managed rows
  managed_event_id    TEXT REFERENCES managed_event(id),       -- set for managed rows; scopes
                                                               --   delete-then-insert to one event
  uid                 TEXT,                                    -- ICS UID (not unique across occurrences)
  title               TEXT NOT NULL,
  location            TEXT,
  description         TEXT,
  starts_at           TEXT NOT NULL,                            -- ISO-8601 UTC
  ends_at             TEXT,                                     -- ISO-8601 UTC, null allowed
  all_day             INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  -- Exactly one origin per row.
  CHECK (
    (source_id IS NOT NULL AND managed_calendar_id IS NULL AND managed_event_id IS NULL)
    OR
    (source_id IS NULL AND managed_calendar_id IS NOT NULL AND managed_event_id IS NOT NULL)
  )
);

INSERT INTO calendar_event_new
  (id, source_id, managed_calendar_id, managed_event_id, uid, title, location, description,
   starts_at, ends_at, all_day, created_at)
SELECT id, source_id, NULL, NULL, uid, title, location, description,
       starts_at, ends_at, all_day, created_at
FROM calendar_event;

DROP TABLE calendar_event;
ALTER TABLE calendar_event_new RENAME TO calendar_event;

CREATE INDEX idx_calendar_event_starts        ON calendar_event (starts_at);
CREATE INDEX idx_calendar_event_source        ON calendar_event (source_id);
CREATE INDEX idx_calendar_event_managed_cal   ON calendar_event (managed_calendar_id);
CREATE INDEX idx_calendar_event_managed_event ON calendar_event (managed_event_id);
