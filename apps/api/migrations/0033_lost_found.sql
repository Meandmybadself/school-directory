-- Lost & found (lostandfound.eisenhower.school, invariant 33).
--
-- Staff photograph what turns up at school; a vision model on Workers AI
-- describes each photo; anyone can browse and say "that's mine"; staff see the
-- claims. Two tables, and neither joins `person` — the same structural defence
-- invariant 26 makes for the store. Nothing here is ABOUT a member, so there is
-- nothing for the enumeration gate to guard and no seam through which a Person
-- row could reach the public projection.
--
-- `visible_text` is the column to be careful with. It holds whatever the model
-- read off the item, and on a school water bottle that is usually a child's
-- name. It is STAFF-ONLY: `publicItemOf` never reads it, and `search_text` —
-- what the public search matches against — is built without it, because a
-- search may not match on more than it renders (invariant 18) and a public
-- "does any item say Milo?" is exactly the oracle invariant 24 forbids.
--
-- No FTS5 table, deliberately. lib/backup.ts discovers tables from
-- `sqlite_master`, and an FTS5 table brings shadow tables a row-by-row export
-- can't round-trip. A school's lost-and-found holds tens to hundreds of items;
-- a LIKE over `search_text` plus the semantic index in Vectorize is plenty.
--
-- The PHOTO can show a name even when no text field does. So an item starts
-- HELD (`held_at` set on insert) and is released automatically only once the
-- model has looked and read no writing on it. If it read some, or failed, the
-- item stays held until staff publish it — after retaking the photo with the
-- label turned away, or deciding the writing is a brand and not a name.
--
-- Photos live in their own R2 bucket (LOSTFOUND_MEDIA), never PHOTOS: they are
-- served by a public route, and keeping them apart is what keeps that route
-- from ever reaching a member's profile photo (invariant 20).

CREATE TABLE lf_item (
  id           TEXT PRIMARY KEY,                       -- ULID
  status       TEXT NOT NULL DEFAULT 'found' CHECK (status IN ('found', 'returned')),
  -- Pulled from the public listing by staff: a face in frame, a duplicate. The
  -- item is still in the office; it is just not on the internet.
  hidden_at    TEXT,
  -- Held for staff review: set on insert, cleared by the model when it reads
  -- no writing on the item, or by staff with "Publish". See the header.
  held_at      TEXT,
  tag_status   TEXT NOT NULL DEFAULT 'pending' CHECK (tag_status IN ('pending', 'tagged', 'failed')),
  tag_error    TEXT,
  title        TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',
  colors       TEXT NOT NULL DEFAULT '[]',             -- JSON array of LF_COLORS
  brand        TEXT NOT NULL DEFAULT '',
  material     TEXT NOT NULL DEFAULT '',
  visible_text TEXT NOT NULL DEFAULT '',               -- STAFF-ONLY; see header
  tags         TEXT NOT NULL DEFAULT '[]',             -- JSON array of keywords
  location     TEXT NOT NULL DEFAULT '',
  -- Lowercased haystack for the public keyword search. Excludes visible_text.
  search_text  TEXT NOT NULL DEFAULT '',
  photo_key    TEXT NOT NULL,
  -- Arrives in a second request (the client sends photo, then thumbnail); until
  -- then the public card falls back to the photo.
  thumb_key    TEXT,
  found_at     TEXT NOT NULL,
  returned_at  TEXT,
  created_by   TEXT REFERENCES user(id),
  updated_at   TEXT NOT NULL
);

-- The public listing: still here, not hidden, not held, newest first.
CREATE INDEX idx_lf_item_listing ON lf_item (status, hidden_at, held_at, found_at DESC);
-- The nightly retry finds failed and stranded-pending items.
CREATE INDEX idx_lf_item_tag_status ON lf_item (tag_status);

-- "That's mine." Written by ANYONE, no session — the first anonymous write in
-- this project that carries free text and contact details (invariant 33 says
-- how it is bounded). Rows double as the claim form's rate limit: the route
-- counts them, so keep `created_at` indexed and don't sweep sooner than a day.
CREATE TABLE lf_claim (
  id          TEXT PRIMARY KEY,                        -- ULID
  item_id     TEXT NOT NULL REFERENCES lf_item(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,                           -- email or phone, exactly as typed
  -- The per-contact cap's key: lowercased, and digits-only when phone-shaped,
  -- so one number written two ways counts once. Never shown to anyone.
  contact_key TEXT NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  resolved_at TEXT,
  resolution  TEXT CHECK (resolution IN ('returned', 'dismissed'))
);

CREATE INDEX idx_lf_claim_open ON lf_claim (resolved_at, created_at);
CREATE INDEX idx_lf_claim_item ON lf_claim (item_id);
CREATE INDEX idx_lf_claim_contact ON lf_claim (contact_key, created_at);
