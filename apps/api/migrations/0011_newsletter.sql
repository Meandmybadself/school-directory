-- 0011_newsletter.sql — Admin-authored newsletters: a rich-text issue mailed to
-- every subscriber and permanently archived on a public web page.
--
-- An issue's body is a TipTap/ProseMirror JSON document (content_json). It is
-- rendered to HTML by packages/shared/src/newsletterRender.ts, which is the ONE
-- renderer used by the email, the composer's live preview, and the public page
-- — the same "one engine" discipline migration 0009 applies to recurrence.
--
-- Upcoming-events blocks inside that document are RESOLVED, not stored: live
-- from calendar_event while the issue is a draft, then frozen into
-- events_snapshot_json the moment the send begins. Without the freeze the
-- archive would drift away from what was actually mailed as the calendar moved
-- on. The snapshot is keyed by the block's `blockId`, not by calendar_event.id,
-- because those ids are not stable (invariant 8).
--
-- An issue is mutable ONLY while status = 'draft'. Sending flips the status
-- with a compare-and-swap (UPDATE ... WHERE status = 'draft', checking the D1
-- result's `changes` count) so a double-clicked Send cannot start a second
-- fan-out. Because the flip has to happen BEFORE the slower audience/event
-- resolution for that guard to work, there is a brief window where status is
-- 'sending' and events_snapshot_json is still NULL — deliberately an
-- application invariant rather than a CHECK constraint.

-- Members opt out individually. Nullable timestamp rather than a boolean so the
-- audit trail carries when, matching user.disabled_at's style. NULL = receiving.
ALTER TABLE user ADD COLUMN newsletter_opt_out_at TEXT;

-- Addresses with no directory account (staff, grandparents, room parents). The
-- audience is the union of these and non-opted-out users, deduped by email.
CREATE TABLE newsletter_subscriber (
  id              TEXT PRIMARY KEY,             -- ULID
  email           TEXT NOT NULL UNIQUE,          -- normalized lowercase
  created_at      TEXT NOT NULL,
  unsubscribed_at TEXT                            -- NULL while subscribed
);

CREATE TABLE newsletter_issue (
  id                   TEXT PRIMARY KEY,          -- ULID
  slug                 TEXT NOT NULL UNIQUE,      -- "2026-08-15-back-to-school"; the public URL
  title                TEXT NOT NULL,
  subtitle             TEXT,
  subject              TEXT NOT NULL,             -- email subject; may differ from title
  content_json         TEXT NOT NULL,             -- TipTap document, sanitized on write
  events_snapshot_json TEXT,                       -- NULL until sending; Record<blockId, CalendarEventDTO[]>
  status               TEXT NOT NULL DEFAULT 'draft',
  recipient_total      INTEGER NOT NULL DEFAULT 0, -- audience size measured when the send began
  sent_at              TEXT,
  created_by           TEXT REFERENCES user(id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK (status IN ('draft', 'sending', 'sent'))
);

-- The archive lists sent issues newest-first; the public lookup is by slug,
-- already covered by its UNIQUE index.
CREATE INDEX idx_newsletter_issue_sent ON newsletter_issue (status, sent_at DESC);

-- One row per recipient per issue, all inserted 'pending' BEFORE any mail is
-- attempted. That ordering is what makes a fan-out interrupted mid-flight
-- (a recycled Worker, a Resend outage) resumable rather than ambiguous: retry
-- simply re-scans for status != 'sent'. It also carries the per-recipient
-- unsubscribe token, which is a plain random value stored here rather than an
-- HMAC — no signing secret to provision, and revoking one is a row update.
CREATE TABLE newsletter_send (
  id                TEXT PRIMARY KEY,             -- ULID
  issue_id          TEXT NOT NULL REFERENCES newsletter_issue(id),
  email             TEXT NOT NULL,                 -- normalized address actually used
  user_id           TEXT REFERENCES user(id),      -- set when the recipient has an account
  subscriber_id     TEXT REFERENCES newsletter_subscriber(id),
  unsubscribe_token TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  error             TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (issue_id, email),
  CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX idx_newsletter_send_issue ON newsletter_send (issue_id, status);
CREATE UNIQUE INDEX idx_newsletter_send_token ON newsletter_send (unsubscribe_token);

-- Sender identity, footer/compliance copy, branding and event defaults are one
-- JSON blob under the existing generic `setting` table (lib/db.ts's
-- getSetting/setSetting), exactly as registration_open and new_user_notify do.
-- No bespoke settings table for a single-row config.
