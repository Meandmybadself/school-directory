-- Drop the "hidden" last-name option: a fully hidden last name leaves too many
-- members sharing a first name. Existing 'hidden' rows fall back to 'initial'.
UPDATE person SET last_name_visibility = 'initial' WHERE last_name_visibility = 'hidden';
