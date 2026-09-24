-- 0029_directory_access.sql — reading the directory becomes something an admin
-- grants, not something signing up confers.
--
-- Until now `requireAuth` was the whole of it: any account that completed a
-- magic link could read every Person in the school. Registration is open, so
-- "any account" meant anyone with an email address. The concern that prompted
-- this was exactly that, and it was correct.
--
-- The fix is an APPLICATION rather than an allowlist, and the distinction is
-- the whole design. An allowlist judges an email address, which carries no
-- claim and cannot be checked against anything — the school's own roster would
-- be the only source, and asking the district for it would drag FERPA
-- obligations onto a system that currently holds no education record at all.
-- An application judges what the applicant TYPED: their name, their child's
-- name, and the room that child is in, picked from the classroom groups this
-- instance already holds under the district's own names. A reviewer can check
-- that in seconds; nobody can check an address.
--
-- The state lives on `user` rather than in a table of its own because the
-- session middleware already joins `user` on every request, so the gate costs
-- no round trip on the API's hot path. What the applicant typed is not copied
-- here either: the Person rows they created ARE the claim, read live by the
-- admin queue, so there is no second copy to drift.
--
--   access_submitted_at  they asked. Set by POST /me/access-request, which
--                        refuses until the claim is complete.
--   access_approved_at   non-null IS the authorization. AuthContext.isApproved
--                        is `!= null` and nothing else.
--   access_declined_at   a decision, reversible by approving.
--   access_decided_by    which admin. Attribution on a surviving record, so
--                        userDeletionStmts NULLs it (invariant 17).
--   access_note          the free-text line the form offers ("my daughter
--                        started in January"). Their words, never translated.
--
-- Declining is deliberately not destructive: it sets a date, the account keeps
-- working for the calendar and the newsletter, and approving later clears it.
ALTER TABLE user ADD COLUMN access_submitted_at TEXT;
ALTER TABLE user ADD COLUMN access_approved_at  TEXT;
ALTER TABLE user ADD COLUMN access_declined_at  TEXT;
ALTER TABLE user ADD COLUMN access_decided_by   TEXT REFERENCES user(id);
ALTER TABLE user ADD COLUMN access_note         TEXT;

-- Grandfather everyone already here, or this deploy locks out the school.
-- The test is having entered ANYBODY: an account with a Person attached has
-- done the thing the new flow asks for, whatever order it happened in. On this
-- instance that approves 66 of 76 and leaves 10 pending — and those ten control
-- no Person at all, which is precisely the shape this gate exists to catch.
-- They keep their accounts and see the application form on their next visit.
UPDATE user
   SET access_approved_at = created_at,
       access_submitted_at = created_at
 WHERE id IN (SELECT DISTINCT user_id FROM control);

-- Every system admin is admitted by AuthContext regardless (being one is a fact
-- about the account, not something a queue decides — the same short-circuit
-- personListableSql makes), but stamping the row keeps the admin screen from
-- listing an admin as pending.
UPDATE user
   SET access_approved_at = COALESCE(access_approved_at, created_at),
       access_submitted_at = COALESCE(access_submitted_at, created_at)
 WHERE is_system_admin = 1;

-- The queue reads "pending" as submitted-and-undecided, ordered oldest first.
CREATE INDEX idx_user_access_pending
  ON user (access_submitted_at, access_approved_at, access_declined_at);
