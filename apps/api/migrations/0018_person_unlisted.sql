-- Off-roster Persons: a real Person the school knows about, withheld from every
-- ordinary member's enumeration of `person`. Still visible to a system admin and
-- to any User who controls them — `control` is many-to-many by design (0001), so
-- "controls" already names exactly the right set of people.
--
-- A nullable timestamp rather than a boolean, matching `user.disabled_at` (0001)
-- and `volunteer_sheet.published_at` (0012): every reversible flag in this schema
-- records WHEN, because "when did we take this person off the roster" is the
-- question an incident review actually asks.
--
-- No index. `person` is school-sized, and every statement that filters on this
-- also filters on something far more selective first — a group's roster, a
-- bounding box, a page of 50.
--
-- See lib/privacy.ts `personListableSql` / `isPersonListable`, and CLAUDE.md
-- invariant 21.

ALTER TABLE person ADD COLUMN unlisted_at TEXT;
