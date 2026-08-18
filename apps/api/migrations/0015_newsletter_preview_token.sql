-- 0015_newsletter_preview_token.sql — an unguessable link a system admin can
-- mint so somebody without a directory account can read an issue before it is
-- sent. A "share this for review" capability URL, not an account: the reader
-- never signs in, and holding the raw token is the whole of the authorization.
--
-- Explicitly NOT auth_token, for the reason migration 0013 spells out:
-- /auth/callback matches on token_hash WITHOUT filtering `kind` and creates a
-- user for any non-'signin' kind, so a second purpose living in that table
-- would turn a review link into an account-creation and sign-in vector. A
-- column on the issue itself cannot mint a session no matter what is done to
-- it.
--
-- Lives on newsletter_issue rather than in its own table. newsletter_confirmation
-- and auth_token are separate tables because they are many-rows-per-address,
-- expiring, single-use and rate-limit-scanned across rows sharing an address —
-- none of which is true here. This token is 1:1 with one issue, optional (most
-- issues never get one), and revoked or replaced IN PLACE by overwriting the
-- same two columns. That is the same "the token lives on the row it authorizes"
-- choice newsletter_send.unsubscribe_token already makes, just nullable and
-- overwritable where that one is neither.
--
-- Hashed at rest like every other bearer token here (lib/crypto.ts). The raw
-- value is returned once, by POST /newsletter/issues/:id/preview-link, and
-- never again — losing it means revoking and re-minting, the same posture as a
-- platform access token. That is why NewsletterIssueDTO carries only
-- `previewLink.active`, never a token: there is nothing to give back.
--
-- Deliberately NOT cleared when the issue sends. The link is revocable with no
-- expiry, so a URL already circulated to a reviewer keeps resolving afterwards
-- and quietly starts showing the sent issue instead of the draft — which is
-- what someone re-opening a link they were sent expects. An admin who wants it
-- dead calls DELETE.

ALTER TABLE newsletter_issue ADD COLUMN preview_token_hash TEXT;
ALTER TABLE newsletter_issue ADD COLUMN preview_token_created_at TEXT;

-- Partial: most rows never hold a live link, and uniqueness only has to hold
-- among the ones that do. (A plain UNIQUE index would also work — SQLite treats
-- every NULL as distinct — but saying so explicitly documents the intent.)
CREATE UNIQUE INDEX idx_newsletter_issue_preview_token
  ON newsletter_issue (preview_token_hash)
  WHERE preview_token_hash IS NOT NULL;
