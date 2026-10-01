-- Who last edited a newsletter issue, and when — for the editors' issue list.
--
-- `updated_at` can't answer "when was this last EDITED": publishing,
-- unpublishing and the send all bump it too (migration 0031), so a draft put on
-- the web this morning would read as edited this morning by nobody in
-- particular. `edited_at` is moved only by a write to the document itself —
-- create and PATCH — and `edited_by` names the account that made it.
--
-- `edited_by` is the REAL user (`realUserId`), the human at the keyboard,
-- matching the audit log's actor column: an admin masquerading as an editor
-- did the typing. It attributes a surviving record, so deleting that account
-- NULLs it (userDeletionStmts) rather than taking the issue with it.
--
-- Backfill: `edited_at` from `updated_at`, the best this table ever knew.
-- `edited_by` from the audit log's latest `created`/`updated` row for the issue
-- — one row per editing SITTING (migration 0020), so it names whoever opened
-- the last sitting, which is right far more often than `created_by` alone —
-- falling back to `created_by`. Only accounts that still exist: D1 enforces
-- foreign keys, and an audit row may outlive its actor.

ALTER TABLE newsletter_issue ADD COLUMN edited_at TEXT;
ALTER TABLE newsletter_issue ADD COLUMN edited_by TEXT REFERENCES user(id);

UPDATE newsletter_issue SET edited_at = updated_at;

UPDATE newsletter_issue
   SET edited_by = COALESCE(
     (SELECT a.actor_user_id
        FROM audit_log a
       WHERE a.entity_kind = 'newsletter_issue'
         AND a.entity_id = newsletter_issue.id
         AND a.action IN ('newsletter.issue.created', 'newsletter.issue.updated')
         AND a.actor_user_id IN (SELECT id FROM user)
       ORDER BY a.id DESC
       LIMIT 1),
     created_by
   );
