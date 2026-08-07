-- 0014_newsletter_subscriber_confirmed.sql — when an address proved itself
-- through the public double opt-in form (migration 0013).
--
-- `created_at` can't answer that question. It is the first-ever sighting of the
-- address and is deliberately NOT bumped by the ON CONFLICT upsert, so someone
-- who unsubscribes and later signs up again keeps their original date — which
-- means a re-subscription is invisible to any window query over created_at.
--
-- Set ONLY by the public confirm route. Admin-side adds (the subscribers screen,
-- bulk import) leave it NULL on purpose, which is what makes it the right column
-- for admin notifications to key on: it mirrors the rule notify.ts already
-- applies to new members — an account created from the admin console never
-- notifies, because the admin who made it already knows.
--
-- Nullable rather than defaulted: every row that predates this migration was
-- added by an admin or by the old single opt-in route, and none of them were
-- confirmed. NULL says that honestly; a backfill to created_at would invent
-- consent records that never happened.

ALTER TABLE newsletter_subscriber ADD COLUMN confirmed_at TEXT;

-- The digest asks "who confirmed since the last run", which is a range scan.
CREATE INDEX idx_newsletter_subscriber_confirmed
  ON newsletter_subscriber (confirmed_at);
