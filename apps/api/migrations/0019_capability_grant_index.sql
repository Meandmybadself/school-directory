-- Make the directory's capability filter affordable.
--
-- `capability_grant` carries exactly one index: its primary key
-- (person_id, capability). That answers "what does this Person hold?", which is
-- every read the table had until now — the profile serializer and the directory
-- page's batched `person_id IN (…)`.
--
-- The filter asks the opposite question: "who holds teacher?" A subquery
-- filtering on `capability` alone can't use a PK whose leading column is
-- person_id, so both statements the listing runs — the page AND its COUNT —
-- would scan every grant in the school on every keystroke of a filtered search.
--
-- (capability, person_id) rather than (capability) alone so the subquery is
-- covering: it selects person_id and nothing else, so the index answers it
-- without touching the table.

CREATE INDEX idx_capability_grant_capability ON capability_grant (capability, person_id);
