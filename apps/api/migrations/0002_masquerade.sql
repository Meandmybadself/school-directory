-- Masquerade support (SDD §4.1). A masquerade is a short-lived session whose
-- user_id is the *target* being viewed, tagged with the acting admin's id and a
-- pointer back to the admin's original session so "Return to admin" can restore it.

ALTER TABLE session ADD COLUMN acting_admin_id TEXT;     -- set => this is a masquerade session
ALTER TABLE session ADD COLUMN parent_session_id TEXT;   -- the admin's session to restore on stop
