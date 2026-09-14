-- 0025_event_meeting_url.sql — an online meeting link on an authored event.
--
-- Two columns, one value. `managed_event.meeting_url` is the editable master
-- copy; `calendar_event.meeting_url` is the materialized read model's copy, set
-- on managed rows only. The value crosses from one to the other the way every
-- other event field does — rendered as an RFC 5545 `URL:` line by
-- lib/icsWriter.ts and read back by parseIcs (invariant 11) — so the published
-- feed carries the link a subscriber's calendar app shows, and the agenda
-- carries the same one.
--
-- Imported rows keep NULL on purpose. An upstream feed's `URL` property, where a
-- district CMS emits one at all, names the event's web page rather than a
-- meeting; refreshSource does not bind it, so nothing on a public feed can be
-- rendered as "join online" without an admin having typed it.
--
-- It is PUBLIC, like `location` and `description`: `publicEventOf` carries it
-- to the anonymous agenda and /ics/:id.ics is served without a session. A link
-- an admin puts on an event anyone can read is where an online event happens.
ALTER TABLE managed_event ADD COLUMN meeting_url TEXT;
ALTER TABLE calendar_event ADD COLUMN meeting_url TEXT;
