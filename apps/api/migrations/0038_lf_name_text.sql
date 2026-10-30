-- Split "what is written on the item" from "the NAME written on it"
-- (invariant 33).
--
-- `visible_text` keeps ALL readable writing, staff-only, and keeps its job as
-- the hold's trigger: any writing at all means the item waits for staff eyes,
-- because the photo can show a name no field does. `name_text` is the subset
-- that is a person's name, and becomes the ONLY thing `scrubNames` cuts from
-- the public title/description/tags: the scrub used to cut EVERY word read off
-- the item, so a brand or team name written on it ("NIKE", "Twins") vanished
-- from the public description and search — and parents searching by brand
-- couldn't find their children's clothing.
--
-- Backfill: treat everything previously read as a name. Already-published
-- items keep exactly the scrubbing they shipped with (the scrub runs on write,
-- so their stored fields are already scrubbed); the copy only matters when a
-- retag or staff save re-runs the scrub, and there "over-scrub like before"
-- is the safe default until fresh eyes or a fresh model pass sort the words.
ALTER TABLE lf_item ADD COLUMN name_text TEXT NOT NULL DEFAULT '';
UPDATE lf_item SET name_text = visible_text;
