-- 0001_init.sql — School Directory initial schema (D1 / SQLite).
-- Identity model: User (credential) ─< Control >─ Person ─< Membership >─ Group.
-- IDs are ULIDs (TEXT). Timestamps are ISO-8601 UTC strings.

-- Credentials -------------------------------------------------------------
CREATE TABLE user (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,            -- normalized lowercase
  email_verified_at TEXT,
  is_system_admin   INTEGER NOT NULL DEFAULT 0,
  locale            TEXT,                            -- en | es | zh, optional override
  created_at        TEXT NOT NULL,
  disabled_at       TEXT
);

-- Directory entities ------------------------------------------------------
CREATE TABLE person (
  id                   TEXT PRIMARY KEY,
  first_name           TEXT NOT NULL,
  last_name            TEXT,
  last_name_visibility TEXT NOT NULL DEFAULT 'full', -- full | initial | hidden
  photo_object_key     TEXT,                         -- R2 key, nullable
  created_at           TEXT NOT NULL
);

-- Shared control: many Users may control many Persons --------------------
CREATE TABLE control (
  user_id    TEXT NOT NULL REFERENCES user(id),
  person_id  TEXT NOT NULL REFERENCES person(id),
  granted_by TEXT REFERENCES user(id),              -- null for bulk/admin/self-claim
  since      TEXT NOT NULL,
  PRIMARY KEY (user_id, person_id)
);

-- Pending invitations to become a co-Controller --------------------------
CREATE TABLE control_invite (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES person(id),
  invited_by TEXT REFERENCES user(id),
  to_email   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',        -- pending | accepted | cancelled
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE capability (
  code TEXT PRIMARY KEY                               -- parent|teacher|staff|student|household_admin
);

CREATE TABLE capability_grant (
  person_id  TEXT NOT NULL REFERENCES person(id),
  capability TEXT NOT NULL REFERENCES capability(code),
  PRIMARY KEY (person_id, capability)
);

CREATE TABLE grp (                                    -- "group" is a reserved word
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,                           -- household | classroom | generic
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE membership (
  group_id  TEXT NOT NULL REFERENCES grp(id),
  person_id TEXT NOT NULL REFERENCES person(id),
  title     TEXT,                                     -- optional free text
  is_admin  INTEGER NOT NULL DEFAULT 0,               -- household_admin / classroom owner
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, person_id)
);

-- Contact items belong to EITHER a person OR a group (household cascade) --
CREATE TABLE contact_item (
  id                    TEXT PRIMARY KEY,
  owner_kind            TEXT NOT NULL,                -- person | group
  owner_id              TEXT NOT NULL,
  type                  TEXT NOT NULL,                -- address | phone | email | url
  label                 TEXT,                         -- "home", "mobile"
  value                 TEXT NOT NULL,
  visibility            TEXT NOT NULL DEFAULT 'private', -- service | private
  sort_order            INTEGER NOT NULL DEFAULT 0,
  -- address-only (server-only, never serialized to clients):
  geo_lat               REAL,
  geo_lng               REAL,
  geocode_status        TEXT NOT NULL DEFAULT 'none', -- none | pending | done | failed
  neighbor_discoverable INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- Explicit shares of a private field or contact item ---------------------
CREATE TABLE share (
  id           TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL,                         -- contact_item | field
  subject_ref  TEXT NOT NULL,                         -- contact_item.id, or "person:{id}:last_name"
  target_kind  TEXT NOT NULL,                         -- person | group
  target_id    TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES user(id),
  created_at   TEXT NOT NULL,
  UNIQUE (subject_kind, subject_ref, target_kind, target_id)
);

-- Auth: magic links and invites share one table -------------------------
CREATE TABLE auth_token (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL,                           -- signin | invite
  token_hash TEXT NOT NULL,                           -- hash; never store the raw token
  person_id  TEXT,                                    -- invite may bind to a pre-created person
  invited_by TEXT REFERENCES user(id),
  reg_open_at_issue INTEGER NOT NULL DEFAULT 0,       -- whether registration was open when issued
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE session (
  id           TEXT PRIMARY KEY,                      -- random; cookie holds this
  user_id      TEXT NOT NULL REFERENCES user(id),
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL,                         -- created_at + 1 year
  revoked_at   TEXT,
  user_agent   TEXT,
  ip           TEXT
);

CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,                   -- ULID = ordered
  actor_user_id   TEXT,                               -- null for system
  masquerading_as TEXT,                               -- user_id when acting under masquerade
  action          TEXT NOT NULL,
  entity_kind     TEXT,
  entity_id       TEXT,
  detail_json     TEXT,
  ip              TEXT,
  user_agent      TEXT,
  prev_hash       TEXT,                               -- hash-chain for tamper evidence
  row_hash        TEXT,
  created_at      TEXT NOT NULL
);

-- Indexes -----------------------------------------------------------------
CREATE INDEX idx_contact_owner       ON contact_item (owner_kind, owner_id);
CREATE INDEX idx_contact_neighbor    ON contact_item (type, neighbor_discoverable);
CREATE INDEX idx_membership_person   ON membership (person_id);
CREATE INDEX idx_membership_group    ON membership (group_id);
CREATE INDEX idx_control_person      ON control (person_id);
CREATE UNIQUE INDEX idx_authtoken_hash ON auth_token (token_hash);
CREATE INDEX idx_session_user        ON session (user_id);
CREATE INDEX idx_share_subject       ON share (subject_kind, subject_ref);
CREATE INDEX idx_audit_created       ON audit_log (created_at);
CREATE INDEX idx_audit_actor         ON audit_log (actor_user_id, created_at);

-- Seed: capabilities + default settings ----------------------------------
INSERT INTO capability (code) VALUES
  ('parent'), ('teacher'), ('staff'), ('student'), ('household_admin');

INSERT INTO setting (key, value) VALUES
  ('registration_open', 'true');
