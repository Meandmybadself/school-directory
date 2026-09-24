-- 0026_user_new_user_notify.sql — new-member notifications become a per-admin
-- choice rather than one instance-wide switch.
--
-- Until now `setting.new_user_notify` decided for every system admin at once:
-- turn it on and all of them were emailed, so an admin who wanted to hear about
-- each sign-up could only get it by signing everyone else up too. The mode now
-- lives on the admin's own `user` row, and lib/notify.ts mails exactly the
-- enabled system admins whose row asks for it.
--
-- `off` is the default (NFR-1), so a newly promoted admin receives nothing until
-- they opt in. The column is kept on a demoted or disabled account and simply
-- ignored — the recipient query also requires `is_system_admin = 1` and
-- `disabled_at IS NULL`, so re-promoting someone restores the choice they made.
ALTER TABLE user ADD COLUMN new_user_notify TEXT NOT NULL DEFAULT 'off'
  CHECK (new_user_notify IN ('off', 'instant', 'daily'));

-- Carry the old instance-wide choice onto every current admin, so the deploy
-- changes nobody's inbox. Anything but a recognised mode stays `off`.
UPDATE user
   SET new_user_notify = COALESCE(
         (SELECT value FROM setting
           WHERE key = 'new_user_notify' AND value IN ('instant', 'daily')),
         'off')
 WHERE is_system_admin = 1;

-- The switch it replaces. Nothing reads it after this migration.
DELETE FROM setting WHERE key = 'new_user_notify';

-- The digest cursor used to advance only while the global mode was `daily`, so
-- on an instance where it was off it can be weeks old. It now advances on every
-- daily run; restart it here so the first digest after this deploy covers one
-- day rather than everyone who joined since the switch was last turned on.
INSERT INTO setting (key, value)
VALUES ('new_user_digest_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
