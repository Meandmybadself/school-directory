-- 0036_ai_budget.sql — a daily ceiling on Workers AI text assists.
--
-- The newsletter composer can ask a model to tighten a draft or to make
-- editorial suggestions (routes/newsletter.ts → lib/newsletterAssist.ts). The
-- model runs on the account's Workers AI allocation, which on the free plan is
-- 10,000 neurons a day SHARED with the lost & found's vision model — so the
-- thing bounded here is the account's model spend, and the row is per UTC DAY
-- for the whole instance, not per user the way `read_budget` (migration 0030)
-- is. Staying inside the free allocation is a product constraint, and a cap
-- that lived only in the client would not be one.
--
-- The claim is an atomic upsert whose DO UPDATE carries `WHERE count < ?`, and
-- `meta.changes` is the answer — D1 has no read-then-write transaction, the
-- same idiom as the volunteer overfill guard (invariant 13). A refused call is
-- NOT counted: unlike `read_budget`, where a script retrying a 429 should
-- spend its day, a refusal here spends no neurons, and neurons are the thing
-- being budgeted.
--
-- Swept after a week by lib/sweep.ts and excluded from backups by
-- lib/backup.ts, exactly as `read_budget` is: it is a counter, and restoring
-- one would only reset or inflate the day's budget.
CREATE TABLE ai_budget (
  day TEXT PRIMARY KEY,     -- UTC day, YYYY-MM-DD
  count INTEGER NOT NULL
);
