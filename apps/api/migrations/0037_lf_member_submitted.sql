-- Lost & found: any signed-in member may now submit a found item, not just the
-- staff roster (invariant 33).
--
-- `member_submitted` marks an item created by someone OUTSIDE the staff roster
-- at the moment it was created (the roster can change afterwards; what matters
-- is who was trusted when the photo arrived). The flag has exactly one effect:
-- the vision model never auto-releases the hold on such an item — reading no
-- writing proves nothing about a photo a non-staff member chose, so it stays
-- held until a staff member looks and presses Publish. Staff uploads and the
-- staff-verified email intake keep the existing behaviour (released when the
-- model read no writing).
--
-- A column rather than a request-time check because the model's write can run
-- long after the request: `retagStuck` re-describes items from the daily cron
-- with no session in sight.

ALTER TABLE lf_item ADD COLUMN member_submitted INTEGER NOT NULL DEFAULT 0;
