-- Default to CLOSED registration. The intended onboarding is: the office is
-- bootstrapped via BOOTSTRAP_ADMIN_EMAILS, signs in (bypassing the toggle),
-- then bulk-imports the roster / invites families, and opens registration only
-- if desired. Bootstrap admins can always sign in regardless of this setting.
-- (Local dev re-opens this via the dev seed.)
UPDATE setting SET value = 'false' WHERE key = 'registration_open';
