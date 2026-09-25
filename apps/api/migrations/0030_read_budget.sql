-- 0030_read_budget.sql — a DAILY ceiling on reading other families, beside the
-- per-minute one.
--
-- The `READ_LIMIT` binding bounds how fast one account may read the directory:
-- 60 a minute. That slows a script without stopping one — 60 a minute is about
-- 86,000 a day, and a patient crawl of a school this size finishes in an
-- afternoon. Cloudflare's rate-limit binding only counts over 10 or 60 seconds,
-- so a day-long window has to be counted here.
--
-- One row per account per UTC day, incremented by an upsert on every budgeted
-- read (`enforceReadRate`, lib/directoryAccess.ts). `alerted_at` is the claim
-- that makes the Slack alert fire ONCE per account per day: a guarded
-- `UPDATE … WHERE alerted_at IS NULL` whose `meta.changes` says who posts, the
-- same idiom as the volunteer overfill guard, because D1 has no read-then-write
-- transaction and a scraper hitting the limit sends many requests at once.
--
-- Swept after a week by lib/sweep.ts, and excluded from backups by
-- lib/backup.ts: it is a counter, and restoring one would only reset or inflate
-- somebody's budget.

CREATE TABLE read_budget (
  user_id    TEXT NOT NULL REFERENCES user(id),
  day        TEXT NOT NULL,              -- YYYY-MM-DD, UTC
  reads      INTEGER NOT NULL DEFAULT 0,
  alerted_at TEXT,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX idx_read_budget_day ON read_budget (day);
