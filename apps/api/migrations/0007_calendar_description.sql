-- 0007_calendar_description.sql — store the ICS DESCRIPTION so event detail
-- views can show it. Populated on the next refresh of each source.
ALTER TABLE calendar_event ADD COLUMN description TEXT;
