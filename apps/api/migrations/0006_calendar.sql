-- 0006_calendar.sql — shared calendar built from public ICS feeds. Admins add
-- ICS source URLs; a scheduled job fetches each feed, expands recurrences, and
-- stores upcoming events. Reads serve from D1. Events are refreshed by
-- delete-then-insert per source (recurrence occurrences share a UID, so there is
-- no stable per-row key to upsert on).

CREATE TABLE calendar_source (
  id              TEXT PRIMARY KEY,                 -- ULID
  url             TEXT NOT NULL,                    -- public ICS feed URL
  name            TEXT NOT NULL,                    -- display name shown on event tags
  color          TEXT NOT NULL DEFAULT '#0068A8',  -- hex, for the source tag
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_fetched_at TEXT,                             -- ISO-8601, null until first fetch
  last_status     TEXT,                             -- ok | error | null
  last_error      TEXT,                             -- short message on failure
  created_at      TEXT NOT NULL
);

CREATE TABLE calendar_event (
  id         TEXT PRIMARY KEY,                      -- ULID
  source_id  TEXT NOT NULL REFERENCES calendar_source(id),
  uid        TEXT,                                  -- ICS UID (not unique across occurrences)
  title      TEXT NOT NULL,
  location   TEXT,
  starts_at  TEXT NOT NULL,                         -- ISO-8601 UTC
  ends_at    TEXT,                                  -- ISO-8601 UTC, null allowed
  all_day    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_calendar_event_starts ON calendar_event (starts_at);
CREATE INDEX idx_calendar_event_source ON calendar_event (source_id);
