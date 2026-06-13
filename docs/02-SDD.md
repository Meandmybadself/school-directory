# School Directory — Software Design Document (SDD)

Version 0.1 (draft for review). Pairs with the SRD.

## 1. Architecture overview

Single-tenant web app on Cloudflare's free tier.

```
            +------------------------+
  Browser   |  React SPA (Pages)     |   cache-first via Service Worker + IndexedDB
  (member)  |  i18n: en / es / zh    |
            +-----------+------------+
                        | fetch (JSON, session cookie)
                        v
            +------------------------+
            |  Hono API (Workers)    |   auth, authz, privacy resolution
            |  - session middleware  |
            |  - audit middleware    |
            +--+------+------+-------++
               |      |      |       |
        D1 (SQL)   R2 (img)  Resend  Geocode
        Prisma*    photos    email   (server-side only)
```

\* Prisma's edge story on D1 is uneven on the free tier; the data layer is defined in Prisma schema for clarity but may be executed via `drizzle-orm` or raw D1 SQL. Schema below is ORM-agnostic.

- **Frontend:** React + Vite, served from Cloudflare Pages. Hono RPC types shared with the Worker.
- **API:** Hono on Cloudflare Workers.
- **DB:** Cloudflare D1 (SQLite).
- **Images:** Cloudflare R2, served via a Worker route with signed, time-limited URLs.
- **Email:** Resend for magic links and invitations.
- **Geocoding:** a server-side provider call at address write time; only lat/long is stored.

## 2. Identity model

The core split is **User (credential)** vs **Person (directory entity)**, joined by a control relationship.

```
User * ──< Control >── * Person          (shared: a Person may have several Controllers)
Person * ──< Membership >── * Group       (optional title per membership)
Group: kind ∈ {household, classroom, generic}
Person * ──< CapabilityGrant >── Capability
ContactItem * ── 1 Person | 1 Group       (cascading when on a Household)
Share: (field|contact_item) → (Person | Group)
```

### 2.1 Why this shape

- A Person with no Controller models bulk-imported teachers and unclaimed kids.
- **Shared control** is a plain many-to-many: two parents are two Control rows on one child Person. Adding a Controller is an invite + accept; removing one is a delete, guarded so the last Controller is not silently dropped.
- **"Transfer"** is now just add-then-remove: grant the new User control, optionally remove the old one.
- Capabilities live on the Person, so "Teacher who is also a Parent" is two grants on one Person, and the active-Person UI can light up Teacher tools or Household tools accordingly.
- Students are Persons only; they are controlled by a parent User and never hold their own credentials in v1.

## 3. Data model (schema)

SQLite/D1 dialect. IDs are ULIDs (sortable, URL-safe). Timestamps are ISO-8601 UTC.

```sql
-- Credentials
CREATE TABLE user (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,         -- normalized lowercase
  email_verified_at TEXT,
  is_system_admin INTEGER NOT NULL DEFAULT 0,
  locale        TEXT,                          -- en | es | zh, optional override
  created_at    TEXT NOT NULL,
  disabled_at   TEXT
);

-- Directory entities
CREATE TABLE person (
  id            TEXT PRIMARY KEY,
  first_name    TEXT NOT NULL,
  last_name     TEXT,
  last_name_visibility TEXT NOT NULL DEFAULT 'full', -- full | initial | hidden
  photo_object_key TEXT,                       -- R2 key, nullable
  created_at    TEXT NOT NULL
);

-- Shared control: many Users may control many Persons
CREATE TABLE control (
  user_id       TEXT NOT NULL REFERENCES user(id),
  person_id     TEXT NOT NULL REFERENCES person(id),
  granted_by    TEXT REFERENCES user(id),     -- null for bulk/admin/self-claim
  since         TEXT NOT NULL,
  PRIMARY KEY (user_id, person_id)
);

-- Pending invitations to become a co-Controller
CREATE TABLE control_invite (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES person(id),
  invited_by    TEXT REFERENCES user(id),
  to_email      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|accepted|cancelled
  token_hash    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE capability (
  code          TEXT PRIMARY KEY              -- parent|teacher|staff|student|household_admin
);

CREATE TABLE capability_grant (
  person_id     TEXT NOT NULL REFERENCES person(id),
  capability    TEXT NOT NULL REFERENCES capability(code),
  PRIMARY KEY (person_id, capability)
);

CREATE TABLE grp (                            -- "group" is reserved
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,               -- household | classroom | generic
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE membership (
  group_id      TEXT NOT NULL REFERENCES grp(id),
  person_id     TEXT NOT NULL REFERENCES person(id),
  title         TEXT,                         -- optional free text
  is_admin      INTEGER NOT NULL DEFAULT 0,   -- household_admin / classroom owner
  joined_at     TEXT NOT NULL,
  PRIMARY KEY (group_id, person_id)
);

-- Contact items belong to EITHER a person OR a group (household cascade)
CREATE TABLE contact_item (
  id            TEXT PRIMARY KEY,
  owner_kind    TEXT NOT NULL,               -- person | group
  owner_id      TEXT NOT NULL,
  type          TEXT NOT NULL,               -- address | phone | email | url
  label         TEXT,                         -- "home", "mobile"
  value         TEXT NOT NULL,                -- string form
  visibility    TEXT NOT NULL DEFAULT 'private', -- service | private
  -- address-only:
  geo_lat       REAL,                         -- server-only, never serialized to client
  geo_lng       REAL,                         -- server-only
  neighbor_discoverable INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- Explicit shares of a private field or contact item
CREATE TABLE share (
  id            TEXT PRIMARY KEY,
  subject_kind  TEXT NOT NULL,               -- contact_item | field
  subject_ref   TEXT NOT NULL,               -- contact_item.id, or "person:{id}:last_name"
  target_kind   TEXT NOT NULL,               -- person | group
  target_id     TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES user(id),
  created_at    TEXT NOT NULL
);

-- Auth: magic links and invites share one table
CREATE TABLE auth_token (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  kind          TEXT NOT NULL,               -- signin | invite
  token_hash    TEXT NOT NULL,               -- hash, never store the raw token
  person_id     TEXT,                         -- invite may bind to a pre-created person
  invited_by    TEXT REFERENCES user(id),
  expires_at    TEXT NOT NULL,
  consumed_at   TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,             -- random; cookie holds this
  user_id       TEXT NOT NULL REFERENCES user(id),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,                -- created_at + 1 year
  revoked_at    TEXT
);

CREATE TABLE setting (
  key           TEXT PRIMARY KEY,            -- e.g. 'registration_open'
  value         TEXT NOT NULL
);

CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,            -- ULID = ordered
  actor_user_id TEXT,                         -- null for system
  masquerading_as TEXT,                       -- user_id when acting under masquerade
  action        TEXT NOT NULL,
  entity_kind   TEXT,
  entity_id     TEXT,
  detail_json   TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL
);
```

### 3.1 Indexes worth calling out
- `contact_item (type, neighbor_discoverable)` for the Neighbors scan.
- `membership (person_id)` and `(group_id)` both directions.
- `auth_token (token_hash)` unique; `session (user_id)`.
- `audit_log (created_at)` and `(actor_user_id, created_at)`.

## 4. Authentication design

One field: email. The Worker branches on state, never telling the client which branch it took (prevents account enumeration).

```
POST /auth/start { email }
  normalize email
  if user exists:                      -> issue signin token, email it
  else if registration_open:           -> issue signin token (creates user on consume)
  else:                                -> issue NOTHING, but respond identically
  always respond: 200 "Check your email"
```

- **Magic link:** `auth_token.kind = signin`, raw token random 32 bytes, stored hashed, TTL 15 min, single use.
- **Consume:** `GET /auth/callback?t=...` verifies hash, marks consumed, creates the User if needed (and only if registration was open at issue time), sets a session cookie.
- **Session:** opaque `session.id` in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. `expires_at = now + 1 year`. `last_seen_at` bumped on use; rotation optional. Revocable from a "your devices" screen and on admin action.
- **Invitations** (`kind = invite`): same machinery, but the token carries `person_id` and `invited_by`. Consuming it both verifies email ownership and binds the User to the pre-created Person, so a forwarded link still requires control of the destination inbox. Invites bypass `registration_open`.

### 4.1 Masquerade
A System admin starting masquerade gets a second, short-lived session marked with `masquerading_as`. All audit entries during it carry both `actor_user_id` (the admin) and `masquerading_as`. The UI shows a persistent banner. Ending masquerade is logged.

## 5. Privacy resolution

The single most important server function. Given a **viewer** (active Person of the requesting User) and a **target field/contact item**, return visible or not.

```
canSee(viewer, item):
  if viewer is a Controller of the owner Person            -> true
  if item.visibility == 'service'                          -> true   # any member
  if item.visibility == 'private':
     if exists Share(item -> viewer.person)                -> true
     if exists Share(item -> any Group containing viewer)  -> true
     else                                                  -> false
```

- **First name:** always visible to co-members of any shared Group (FR-15). Treated as implicitly `service` within shared groups.
- **Last name:** the `full | initial | hidden` setting is applied *after* `canSee`. If hidden-by-policy, the server returns only the initial or nothing, never the full string, even to permitted viewers other than controllers.
- **Household cascade:** a Person with no own Address inherits the Household's Address contact item; resolution runs against the Household-owned item, honoring its visibility. A Person may override by adding their own Address.
- **Server enforcement only.** The client never receives data it cannot see. Filtering happens in the Worker before serialization. `geo_lat/geo_lng` are *never* serialized regardless of permission.

## 6. Neighbors design

The one feature that uses private location without exposing it.

1. On address mutation, the server geocodes via **Nominatim** (OpenStreetMap) to `geo_lat/geo_lng`, stored on the `contact_item`. Coordinates are never sent to clients. Geocoding runs only when an address is created or changed, not on read.

   **Nominatim compliance** (the public endpoint has hard rules): send a descriptive `User-Agent`/`Referer` identifying this app (stock HTTP-library user-agents are rejected), stay at or under one request per second, and display OSM attribution wherever a derived map/area is shown. Because geocoding fires only on address mutation in a single school, volume sits far under the limit. The Worker SHALL serialize geocode calls through a single-flight queue (one in flight, brief backoff on 429) so a bulk import never bursts past 1 rps. If volume ever grows, swap in a self-hosted Nominatim or a paid provider behind the same internal interface.
2. Neighbor scan for viewer V (active Person has an address A with coords):
   ```
   candidates = contact_items where type='address'
                and neighbor_discoverable = 1
                and owner != V's person/household
   for each c: if haversine(A, c) <= 2 miles -> include
   return: { person_or_household name, approx_distance }   # e.g. "~1.3 mi"
   ```
3. **Approximate area only.** The response carries a rounded distance and, optionally, a marker snapped to a coarse grid (OQ-4). Never the raw coordinates or the address string.
4. **Discoverability is opt-in and independent of visibility.** A `private` address with `neighbor_discoverable = 0` is invisible to the scan. This resolves the tension between "address is Private" and "neighbors see my name."
5. If V has no address: return the add-address CTA payload instead of a list.

Scale note: a single school is hundreds to low thousands of Persons. A full scan with an in-Worker haversine is fine on D1; no geospatial index needed at this size. A bounding-box pre-filter on lat/lng keeps it cheap.

## 7. Internationalization

- UI strings in per-locale JSON (`en`, `es`, `zh`), loaded on demand, cached by the service worker.
- Locale resolution: User override -> `Accept-Language` -> default `en`.
- ICU message format for plurals/gender where the three languages diverge.
- **Only chrome is translated.** Member-entered content is stored and shown verbatim (FR-34).
- Dates/numbers via `Intl`. Names render first/last per locale order where it matters.

## 8. Offline / cache-first

- **Service worker** with a stale-while-revalidate strategy for the app shell and API GETs the User is permitted to see.
- **IndexedDB** mirror of the last directory payload the User loaded (already privacy-filtered by the server, so the cache only ever holds permitted data).
- Cache scope: everything the User can currently see.
- **Read-only offline.** On loss of connectivity the client enters read-only mode: mutating controls are disabled with a "reconnect to make changes" state. Writes are **not** queued (FR-36). Connectivity is determined by `navigator.onLine` plus a lightweight heartbeat to the API, since `onLine` alone is unreliable.

## 9. Bulk upload and invitations

- CSV import (admin) with a column map: `first_name,last_name,email?,group,title?,capabilities?`.
- Pipeline: validate -> dedupe on normalized email and on (first,last,group) -> create unclaimed Persons -> create/merge Groups and Memberships -> queue `invite` tokens for rows with emails.
- Idempotent: a re-run of the same file produces no duplicates (FR-30). A dry-run mode reports what would change.
- Invites are rate-limited per recipient and batched through Resend.
- **Geocoding is deferred, not inline.** Imported addresses are written immediately with `geo_lat/geo_lng` null and a `pending_geocode` flag; a background queue drains them at <=1 rps to respect Nominatim. Neighbors simply omits not-yet-geocoded addresses until coordinates land. A 300-address import is searchable instantly and fully geocoded within a few minutes.

## 10. API surface (representative)

```
POST   /auth/start                 { email }
GET    /auth/callback?t=...
POST   /auth/signout
GET    /me                          -> user, controllable persons, active person
POST   /me/active-person            { personId }

GET    /persons/:id                 -> privacy-filtered profile
PATCH  /persons/:id                 (controller/co-manager)
POST   /persons/:id/contacts
PATCH  /contacts/:id                (visibility, label, neighbor_discoverable)
POST   /persons/:id/shares          { subject, target }
DELETE /shares/:id

POST   /persons/:id/controllers     { email }        -> pending control invite
POST   /control-invites/:id/accept
DELETE /persons/:id/controllers/:userId               (with last-controller guard)

GET    /groups/:id                  -> members (filtered), titles
POST   /groups (classroom)          (teacher)
POST   /households                  (any member) ; PATCH household contacts (admin)

GET    /home/neighbors              -> [{ name, approxDistance }]  | { addCta: true }

POST   /admin/invite                { email, personId? }   (bypasses registration)
POST   /admin/bulk-import           (CSV)
POST   /admin/masquerade            { userId }
GET    /admin/audit?filters

GET    /settings/registration       ; PUT (admin)
```

All mutating routes pass through audit middleware.

## 11. Security and privacy notes

- Tokens stored hashed; raw tokens only in the emailed URL. Single-use, short TTL.
- Sessions long-lived but server-revocable; cookie is `HttpOnly`/`Secure`/`SameSite=Lax`.
- **Geocoordinates never serialized to any client.** Neighbor responses carry rounded distance only.
- New fields default to `private`; neighbor discovery defaults off (NFR-1).
- Account enumeration avoided at `/auth/start` and when registration is off.
- **Offline cache posture:** the local cache holds the directory data the User can already see. This is treated as equivalent to the device's own contacts list, which would be equally exposed on a lost device, so it is an **accepted risk**, not a mitigated one. Cache is purged on signout as basic hygiene. No client-side encryption of the store in v1.
- Audit log append-only; consider periodic hash-chaining of rows for tamper evidence.

## 12. Deployment / CI

- Monorepo: `apps/web` (React/Pages), `apps/api` (Hono/Workers), `packages/shared` (types, i18n).
- **GitHub Actions on merge to `main`:** run tests -> apply D1 migrations -> deploy Worker (`wrangler deploy`) -> deploy Pages. Preview deploys on PRs.
- Secrets (Resend key, geocoder key) via Wrangler secrets / GitHub encrypted secrets.
- Free-tier posture: Workers + D1 + R2 + Pages free plans; Resend free tier for email volume of a single school.

## 13. Extensibility for future services

- Future Volunteer/Events and Interests services read identity via a stable internal API: `Person`, `Membership`, Capability grants. They store their own data keyed by `person_id`.
- Capabilities and Shares are the extension points: an Interests service adds shareable "interest" subjects under the same Share model; a Volunteer service reads Group membership to scope events.
- Those services are **not built here** (FR-37).

## 14. Phasing suggestion

- **M1 — Identity core:** User/Person/Control, email auth, sessions, profiles, basic privacy resolution, audit log.
- **M2 — Groups:** Households + Classrooms, memberships/titles, cascade, shares, capability-gated UI.
- **M3 — Neighbors + i18n + offline cache.**
- **M4 — Bulk import, invitations at scale, masquerade, admin console.**
