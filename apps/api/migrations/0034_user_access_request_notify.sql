-- 0034_user_access_request_notify.sql — an admin chooses whether "directory
-- access requested" emails reach their own inbox.
--
-- Until now every system admin and every bootstrap address got one email per
-- application, with no way out (lib/notify.ts, `notifyAccessRequest`). It is
-- now per admin, like `new_user_notify` (migration 0026), and OFF by default
-- like it too (NFR-1): a newly promoted admin is emailed nothing until they
-- opt in under Admin → Notifications.
--
-- A plain on/off, not a NotifyMode: there is no digest of applications, since
-- a queue item that waits a day for its email has waited a day for nothing.
ALTER TABLE user ADD COLUMN access_request_notify INTEGER NOT NULL DEFAULT 0
  CHECK (access_request_notify IN (0, 1));

-- This instance's own starting point, asked for when the switch shipped: two
-- admins work the access queue, so only they keep the email. Keyed on email
-- rather than id so it reads as the decision it records.
UPDATE user
   SET access_request_notify = 1
 WHERE is_system_admin = 1
   AND lower(email) IN ('meandmybadself@gmail.com', 'rddhuria@gmail.com');
