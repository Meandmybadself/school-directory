-- 0013_newsletter_confirmation.sql — double opt-in for the public subscribe
-- form. A pending confirmation is a token mailed to the address that was typed
-- in; only clicking it puts the address on the list.
--
-- Migration 0011's subscribe route was single opt-in, and its comment named the
-- fix: "a confirmation link through the existing auth_token machinery." This is
-- that fix, but deliberately NOT on auth_token. /auth/callback looks a token up
-- by hash and mints a session WITHOUT filtering on `kind` — and for any kind
-- other than 'signin' it creates the user unconditionally, bypassing the
-- registration-closed toggle. Putting a newsletter token in that table would
-- therefore turn an anonymous, public form into an account-creation and
-- sign-in vector: type an address, and the link mailed to it signs its owner
-- in. A separate table cannot mint a session no matter what is done to it,
-- which is the whole reason it is separate.
--
-- The raw token is only ever in the emailed URL; the hash is what is stored,
-- matching auth_token's discipline (lib/crypto.ts).

CREATE TABLE newsletter_confirmation (
  id          TEXT PRIMARY KEY,   -- ULID
  email       TEXT NOT NULL,      -- normalized lowercase, as typed into the form
  token_hash  TEXT NOT NULL,      -- SHA-256 of the token in the emailed link
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,               -- NULL until the link is actually clicked
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_newsletter_confirmation_token
  ON newsletter_confirmation (token_hash);

-- Supports the two rate checks on the send path, which both scan this window:
-- one per address (a stranger can't flood one inbox) and one instance-wide (a
-- script walking a harvested list can't turn the form into a spam cannon).
-- A row is written only when a mail is actually sent, so these counts are send
-- counts and the table grows only as fast as we are willing to send.
--
-- Rows are swept once they are past `expires_at`, or consumed and a day old —
-- `sweepExpiredConfirmations` on the daily cron. Nothing reads a row after
-- either point, and this is the one table an anonymous route can grow.
CREATE INDEX idx_newsletter_confirmation_email
  ON newsletter_confirmation (email, created_at);

-- The sweep and the instance-wide cap both range over time, not over address.
CREATE INDEX idx_newsletter_confirmation_created
  ON newsletter_confirmation (created_at);
