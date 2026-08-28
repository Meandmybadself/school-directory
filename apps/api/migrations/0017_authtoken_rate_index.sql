-- Make the sign-in rate limit affordable, and stop the table it counts from
-- growing forever.
--
-- `/auth/start` counts the magic links sent in the last rolling day, per address
-- and instance-wide. That query filters on (kind, created_at), and auth_token
-- carried exactly one index — on token_hash — so every sign-in ATTEMPT, from
-- anyone, scanned the whole table. The table also had no delete path anywhere in
-- the codebase, so it only ever grew: the scan got slower every time anybody
-- signed in.
--
-- newsletter_confirmation, which the rate limit was modelled on, has had both
-- halves since migration 0013 — (email, created_at) and (created_at) indexes,
-- plus sweepExpiredConfirmations on the daily cron. The pattern was copied
-- without them. This is the index; lib/notify.ts has the sweep.
--
-- The composite is (kind, created_at) rather than (created_at) alone because the
-- count is always scoped to kind='signin' — an invite token must not eat a
-- family's sign-in budget.

CREATE INDEX idx_authtoken_kind_created ON auth_token (kind, created_at);
