-- 0010_auth_token_return_to.sql — carry the initiating app's origin through a
-- sign-in token so the magic-link callback can return the member to whichever
-- app started the sign-in (directory or calendar), instead of always the single
-- APP_URL. NULL means "pre-existing row, or no returnTo was supplied", and the
-- callback falls back to APP_URL exactly as before.
--
-- Not an open redirect: the value is validated against ALLOWED_ORIGINS when the
-- token is issued AND again when the redirect is emitted, so only origins the
-- operator already trusts for credentialed CORS can ever be stored or used.

ALTER TABLE auth_token ADD COLUMN return_to TEXT;
