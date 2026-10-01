-- Publishing an issue's web page becomes its own act, separate from sending.
--
-- Until now `status = 'sent'` was both "it went to inboxes" and "its /n/:slug
-- page is public": the archive and the page gated on it in SQL, and the only
-- way to put a page up was to mail it. Editors asked for the two apart — a
-- printed-only issue that is never emailed still wants a page for its QR code,
-- and an issue can go up on the web days before it is mailed.
--
-- `published_at` is that gate now. Non-null IS public: the archive lists and
-- `/newsletter-public/issues/:slug` serves exactly the rows that carry it, and
-- nothing else does, so a guessed draft slug still reveals nothing (invariant
-- 10). Unpublishing clears it. Sending still sets it (COALESCE, so a page put
-- up earlier keeps its original date), because the email's "view in browser"
-- link would otherwise 404.
--
-- It is orthogonal to `status`: a published DRAFT is still editable, and its
-- page shows the edits with events resolved live, exactly as a review link
-- does. Only a SENT issue is frozen.
--
-- Backfill: every issue a send has begun on was public under the old rule, or
-- about to be (`sending` has `sent_at` set), so it keeps its page and keeps the
-- date the archive already sorted it by.

ALTER TABLE newsletter_issue ADD COLUMN published_at TEXT;

UPDATE newsletter_issue SET published_at = sent_at WHERE sent_at IS NOT NULL;

-- The archive lists published issues newest-first.
CREATE INDEX idx_newsletter_issue_published
  ON newsletter_issue (published_at DESC) WHERE published_at IS NOT NULL;
