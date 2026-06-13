# School Directory — Software Requirements Document (SRD)

Version 0.1 (draft for review)

## 1. Purpose and scope

A privacy-conscious online directory for a single school community. It lets members share contact information selectively and serves as the **identity foundation** for later services (Volunteer/Events and Interests matching). Those later services are out of scope here except where this system must expose hooks for them.

This is a **single-tenant** system (one school per deployment). Multi-tenancy is explicitly out of scope for v1.

## 2. Definitions

These terms are load-bearing. Where this document capitalizes a word, it means the definition below, not the everyday sense.

- **User** — a credential set. How a human logs in. Identified by a verified email address. A User is not a directory entry and is never listed in the directory.
- **Person** — a directory entity with a profile (name, contacts, photo). The thing other members see. A Person may exist with no controlling User (e.g. a bulk-imported teacher who has not logged in, or a child).
- **Controller** — a User who can act on behalf of a Person. A Person may have **multiple Controllers at once** (e.g. two parents managing the same child). Controllers are added and removed by invitation/grant; the relationship is what "transfer" operates on.
- **Group** — a named collection of Persons. A Person may belong to many Groups.
- **Household** — a subtype of Group. Has cascading contact information (e.g. a shared address) and a Household admin.
- **Classroom** — a subtype of Group, managed by Persons holding a Teacher capability.
- **Capability** — a role a Person can hold: `parent`, `teacher`, `staff`, `student`, `household_admin`, plus system-level `system_admin` on the User. A Person may hold several at once (a Teacher who is also a Parent).
- **Membership** — the link between a Person and a Group. May carry an optional **title** (free text, e.g. "Teacher", "Assistant", "Parent").
- **Share** — an explicit grant that exposes one of a Person's fields or contact items to another Person or to a Group.
- **Visibility** — the privacy level on a field or contact item: `service` ("Public" — any authenticated member of this instance) or `private` (only the Person, its Controller/Co-managers, and explicit Share targets).

> Note on "Public": nothing is ever exposed to the unauthenticated internet. **Public = visible to authenticated members of this service.** This is the strongest exposure the system offers.

## 3. Actors

1. **Member** — any User controlling at least one Person. Subdivided by the Capabilities their Persons hold.
2. **Household admin** — a Member who manages a Household Group.
3. **Teacher** — a Member whose active Person holds the `teacher` Capability; manages Classrooms.
4. **System administrator** — a User with `system_admin`; can invite even when registration is off, masquerade, run bulk imports, and read the audit log.

## 4. Functional requirements

### 4.1 Authentication and accounts
- FR-1 The system SHALL authenticate by email only. There is **no separate Sign Up vs Log In**. The user enters an email; the system decides the path.
- FR-2 Email sign-in SHALL use a one-time link/code delivered via Resend ("magic link").
- FR-3 Sessions SHALL last one year from last verification, renewable silently.
- FR-4 Registration SHALL be globally toggleable (on/off) by a System administrator.
- FR-5 When registration is **off**, an unknown email entered at sign-in SHALL be told sign-up is closed, and SHALL NOT reveal whether that email already exists.
- FR-6 When registration is **off**, a System administrator MAY still invite new Users; an invited email bypasses the toggle.
- FR-7 An invitation email SHALL prove email ownership: following the invite link both verifies the address and binds it to the intended User/Person, so the invitee cannot be impersonated by a forwarded link beyond ownership of the inbox.

### 4.2 Users, Persons, control
- FR-8 A User MAY control multiple Persons.
- FR-9 A Person MAY have multiple Controllers at once (zero if unclaimed).
- FR-10 A User acting in the app SHALL select an **active Person** and MAY switch between the Persons they control.
- FR-11 A Controller MAY invite another User to become a co-Controller of a Person. The invitee SHALL accept (or the grant SHALL be performed by a System administrator).
- FR-12 A Controller MAY remove another Controller from a Person, and MAY remove themselves. The last remaining Controller SHALL NOT be removed without either adding a replacement or an explicit unclaim action (prevents orphaning without intent).
- FR-13 A System administrator MAY masquerade as any User. Masquerade SHALL be audit-logged at start and end and SHALL be visually indicated in the UI.

### 4.3 Profiles
- FR-14 A Person profile SHALL support: First name (required), Last name, one or more Contact items, and one Profile photo.
- FR-15 First name SHALL always be visible to every Group the Person belongs to. (If a Person will not show a first name to their groups, they should not join.)
- FR-16 Last name visibility SHALL offer: full, last-initial-only, or hidden.
- FR-17 Contact items SHALL be of type Address, Phone, Email, or URL, repeatable, each independently labeled (e.g. "mobile", "home") and independently set to `service` or `private`.
- FR-18 Each `private` field/contact item MAY be Shared with specific Persons or Groups.

### 4.4 Groups and Households
- FR-19 A Person MAY belong to multiple Groups including simultaneously a Household and one or more Classrooms.
- FR-20 A Membership MAY carry an optional title.
- FR-21 A Household SHALL be a Group that can hold contact information cascading to its members (e.g. address), overridable per Person.
- FR-22 A Household admin SHALL manage Household membership and Household-level contact info.
- FR-23 A Teacher SHALL be able to create and manage Classrooms and their Memberships.

### 4.5 Neighbors (address proximity)
- FR-24 Every Address SHALL be geocoded server-side to coordinates stored server-side only and **never returned to clients**.
- FR-25 An Address MAY be marked discoverable-as-Neighbor independently of its `service`/`private` visibility. A `private` address is **not** discoverable unless this is explicitly enabled.
- FR-26 The Home page SHALL surface "Neighbors": other discoverable Persons/Households within a 2-mile radius of the active Person's address, showing **name and approximate area only** (not the exact address) until a connection/share is made.
- FR-27 If the active Person has no address, the Home page SHALL show a call to action to add one.

### 4.6 Invitations and bulk operations
- FR-28 A Member with the appropriate Capability (e.g. Household admin, Teacher) MAY invite other Users/Persons into their Group.
- FR-29 The system SHALL support bulk upload of Users and Persons (CSV), including pre-creating unclaimed Persons and queuing invitations.
- FR-30 Bulk operations and invitations SHALL be idempotent on email and SHALL not create duplicate Persons for the same imported identity within one import.

### 4.7 Administration and audit
- FR-31 The system SHALL maintain an **append-only audit log** capturing at minimum: sign-in, invite sent/accepted, control transfer, co-manager grant/revoke, masquerade start/stop, share create/revoke, bulk import, registration toggle, and admin actions. Each entry records actor User, affected entity, action, timestamp, and source IP/user-agent where available.
- FR-32 System administrators SHALL be able to read and filter the audit log.

### 4.8 Internationalization
- FR-33 The UI SHALL be internationalized with English, Spanish, and Chinese at launch, and SHALL be structured so additional locales are config/data, not code changes.
- FR-34 User-entered content SHALL NOT be machine-translated; only UI chrome is localized.

### 4.9 Offline / availability
- FR-35 The client SHALL be cache-first: previously loaded directory data the User is permitted to see SHALL remain available read-only without connectivity.
- FR-36 The client SHALL be read-only when offline. Write operations SHALL be disabled (not queued) once the client determines it is offline, and SHALL re-enable on reconnect.

### 4.10 Extensibility hooks (for future services)
- FR-37 The system SHALL expose a stable Person identity and Group membership read API for downstream services (Volunteer/Events, Interests). Those services are **not built here**.

## 5. Non-functional requirements

- NFR-1 **Privacy by default.** New fields default to `private`. Neighbor discovery is opt-in.
- NFR-2 **Cost.** Runs on free tiers of Cloudflare (Workers, D1, R2, Pages) and Resend free tier. No always-on paid infra.
- NFR-3 **Responsive.** Mobile-first, works at 360px width up.
- NFR-4 **Accessibility.** Keyboard navigable, visible focus, respects reduced motion, meets WCAG 2.1 AA for contrast and labels.
- NFR-5 **Security.** Magic-link tokens single-use and short-lived; sessions are long-lived but revocable; no PII in client logs; geocoordinates never leave the server.
- NFR-6 **Auditability.** Audit log is append-only and tamper-evident.
- NFR-7 **Deployability.** CI deploys on merge to `main` from GitHub.
- NFR-8 **Data portability.** A User can export the data for Persons they control.

## 6. Resolved decisions (formerly open questions)

- Control is **shared**: multiple Controllers per Person, added by invitation/acceptance, removable with last-Controller protection.
- **Students do not get their own Users.** A student is a Person controlled by a parent/guardian User. No student-age self-claim flow in v1.
- **Offline is read-only.** Writes are disabled while offline rather than queued.
- **Neighbor approximate area** is derived from lat/lon (rounded distance, optional coarse marker). Addresses are geocoded on mutation via Nominatim.
- **No photo moderation.** Members are trusted; admins retain takedown.

Note retained for sign-off: Neighbor discoverability is an **opt-in toggle independent of address visibility** (a Private address is not surfaced as a Neighbor unless explicitly enabled). Flag if you want any address to surface name + area regardless.
