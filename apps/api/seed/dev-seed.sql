-- Local development seed. Mirrors the design mocks (Ruiz–Lee household, Grade 4).
-- Apply with: pnpm db:seed:local  (after db:migrate:local)
-- Sign in as dana@eisenhower.edu — the magic link prints to the API console.

-- Clear in dependency order so the seed is safely re-runnable (sessions/tokens
-- created by sign-in testing reference user rows).
DELETE FROM audit_log; DELETE FROM session; DELETE FROM auth_token;
DELETE FROM control_invite; DELETE FROM share;
DELETE FROM membership; DELETE FROM contact_item; DELETE FROM capability_grant;
DELETE FROM control; DELETE FROM grp; DELETE FROM person; DELETE FROM user;

-- Local dev keeps registration open (prod defaults closed via migration 0004).
INSERT INTO setting (key, value) VALUES ('registration_open', 'true')
  ON CONFLICT(key) DO UPDATE SET value = 'true';

-- Users
INSERT INTO user (id, email, email_verified_at, is_system_admin, created_at) VALUES
  ('usr_dana',   'dana@eisenhower.edu',   '2025-01-01T00:00:00.000Z', 1, '2025-01-01T00:00:00.000Z'),
  ('usr_marcus', 'marcus@eisenhower.edu', '2025-01-01T00:00:00.000Z', 0, '2025-01-01T00:00:00.000Z');

-- Persons
INSERT INTO person (id, first_name, last_name, last_name_visibility, created_at) VALUES
  ('per_dana',    'Dana',    'Ruiz', 'initial', '2025-01-01T00:00:00.000Z'),
  ('per_marcus',  'Marcus',  'Lee',  'full',    '2025-01-01T00:00:00.000Z'),
  ('per_charlie', 'Charlie', 'Lee',  'initial', '2025-01-01T00:00:00.000Z'),
  ('per_allie',   'Allie',   'Ruiz', 'initial', '2025-01-01T00:00:00.000Z'),
  ('per_sara',    'Sara',    'Okafor','full',   '2025-01-01T00:00:00.000Z');

-- Control (Dana controls herself + both kids; Marcus co-controls the kids)
INSERT INTO control (user_id, person_id, since) VALUES
  ('usr_dana',   'per_dana',    '2025-01-01T00:00:00.000Z'),
  ('usr_dana',   'per_charlie', '2025-01-01T00:00:00.000Z'),
  ('usr_dana',   'per_allie',   '2025-01-01T00:00:00.000Z'),
  ('usr_marcus', 'per_marcus',  '2025-01-01T00:00:00.000Z'),
  ('usr_marcus', 'per_charlie', '2025-01-01T00:00:00.000Z'),
  ('usr_marcus', 'per_allie',   '2025-01-01T00:00:00.000Z');

-- Capabilities
INSERT INTO capability_grant (person_id, capability) VALUES
  ('per_dana', 'parent'), ('per_dana', 'teacher'),
  ('per_marcus', 'parent'), ('per_marcus', 'household_admin'),
  ('per_charlie', 'student'), ('per_allie', 'student'),
  ('per_sara', 'student');

-- Groups
INSERT INTO grp (id, kind, name, created_at) VALUES
  ('grp_household', 'household', 'Ruiz–Lee household', '2025-01-01T00:00:00.000Z'),
  ('grp_class',     'classroom', 'Ms. Ruiz · Grade 4', '2025-01-01T00:00:00.000Z');

-- Memberships
INSERT INTO membership (group_id, person_id, title, is_admin, joined_at) VALUES
  ('grp_household', 'per_marcus',  'Parent', 1, '2025-01-01T00:00:00.000Z'),
  ('grp_household', 'per_dana',    'Parent', 0, '2025-01-01T00:00:00.000Z'),
  ('grp_household', 'per_charlie', 'Student · Grade 4', 0, '2025-01-01T00:00:00.000Z'),
  ('grp_household', 'per_allie',   'Student · Grade 1', 0, '2025-01-01T00:00:00.000Z'),
  ('grp_class', 'per_dana',    'Teacher', 1, '2025-01-01T00:00:00.000Z'),
  ('grp_class', 'per_charlie', 'Student', 0, '2025-01-01T00:00:00.000Z'),
  ('grp_class', 'per_sara',    'Student', 0, '2025-01-01T00:00:00.000Z');

-- Contact items for Dana
INSERT INTO contact_item (id, owner_kind, owner_id, type, label, value, visibility, neighbor_discoverable, geocode_status, sort_order, created_at, updated_at) VALUES
  ('ci_dana_email', 'person', 'per_dana', 'email', 'Email',  'dana.ruiz@eisenhower.edu', 'service', 0, 'none', 0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_dana_phone', 'person', 'per_dana', 'phone', 'Mobile', '(415) 555-0148',           'service', 0, 'none', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_dana_web',   'person', 'per_dana', 'url',   'Website','danaruiz.studio',           'private', 0, 'none', 2, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_dana_addr',  'person', 'per_dana', 'address','Home Address',  '128 Linden Ave',            'private', 1, 'done', 3, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');

UPDATE contact_item SET geo_lat = 37.7849, geo_lng = -122.4094 WHERE id = 'ci_dana_addr';

-- Household-owned (cascading) contact info shown on the Household screen.
INSERT INTO contact_item (id, owner_kind, owner_id, type, label, value, visibility, geocode_status, sort_order, created_at, updated_at) VALUES
  ('ci_hh_addr',  'group', 'grp_household', 'address', 'Shared address', '128 Linden Ave', 'service', 'done', 0, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_hh_phone', 'group', 'grp_household', 'phone',   'Home phone',      '(415) 555-0148', 'private', 'none', 1, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
-- Geocode the household address (same house) so it cascades to members without
-- their own address when computing Neighbors.
UPDATE contact_item SET geo_lat = 37.7849, geo_lng = -122.4094 WHERE id = 'ci_hh_addr';

-- A few discoverable neighbors near Dana so Home shows the Neighbors module.
INSERT INTO person (id, first_name, last_name, last_name_visibility, created_at) VALUES
  ('per_james', 'James', 'Whitfield', 'full', '2025-01-01T00:00:00.000Z'),
  ('per_lena',  'Lena',  'Brandt',    'full', '2025-01-01T00:00:00.000Z'),
  ('per_tomas', 'Tomás', 'Rivera',    'full', '2025-01-01T00:00:00.000Z');

INSERT INTO capability_grant (person_id, capability) VALUES
  ('per_james', 'parent'), ('per_lena', 'parent'), ('per_tomas', 'parent');

INSERT INTO contact_item (id, owner_kind, owner_id, type, label, value, visibility, neighbor_discoverable, geocode_status, geo_lat, geo_lng, created_at, updated_at) VALUES
  ('ci_sara_addr',  'person', 'per_sara',  'address', 'Home Address', '12 Birch St',   'private', 1, 'done', 37.7853, -122.4140, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_james_addr', 'person', 'per_james', 'address', 'Home Address', '440 Oak Ave',   'private', 1, 'done', 37.7900, -122.4060, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_lena_addr',  'person', 'per_lena',  'address', 'Home Address', '78 Cedar Ct',   'private', 1, 'done', 37.7770, -122.4180, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z'),
  ('ci_tomas_addr', 'person', 'per_tomas', 'address', 'Home Address', '901 Maple Way', 'private', 1, 'done', 37.7960, -122.4200, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z');
