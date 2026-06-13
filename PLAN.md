# Build Plan — Eisenhower School Directory

Living document. We iterate against this; check items off as they land and add notes
inline. Read `docs/00-PLAN.md` → `docs/01-SRD.md` → `docs/02-SDD.md` for the product
spec; this file is the **engineering execution plan**.

## Locked decisions (this build)

These resolve the open items the design handoff flagged ("pick before building"):

| Decision | Choice | Why |
|---|---|---|
| Visual style | **Calm-institutional** (Hanken Grotesk, blue/orange) | The board's primary direction; neutral and trustworthy. Warm/serif kept as a future theme. |
| Home layout | **Layout A** (Neighbors grid) | Canonical `HomeScreen`; switcher pill in app bar. |
| First iteration | **Scaffold + M1 identity core** | Smallest end-to-end vertical slice that proves the architecture. |
| Cloudflare setup | **Local-first** via `wrangler dev` + local D1 | Remote provisioning documented but not executed (outward-facing). |
| School identity | **Config-driven** (`SCHOOL_NAME`, default `Eisenhower`) | Single-tenant but not hardcoded. |
| Neighbor opt-in (SRD decision 5) | **Opt-in, independent of address visibility** | Per spec; a private address is never surfaced as a neighbor unless explicitly enabled. |

## Architecture at a glance

```
apps/web      React + Vite SPA  → Cloudflare Pages   (design system, screens, i18n, offline SW)
apps/api      Hono on Workers   → auth, authz, privacy resolution, audit, D1/R2/Resend/geocode
packages/shared  TS types + i18n dictionaries shared by web & api
apps/api/migrations  D1 (SQLite) schema, ordered SQL
```

Identity model: **User** (credential) ─< Control >─ **Person** (directory entity) ─< Membership >─ **Group**.
Privacy is resolved **server-side only**; geocoordinates are never serialized to clients.

---

## Milestones

### M0 — Scaffold (foundation)  ◀ this iteration
- [x] Monorepo workspace (pnpm), tsconfig base, lint/format config
- [x] `PLAN.md`, `README.md`, `CLAUDE.md`
- [x] D1 schema + first migration (full schema from SDD §3)
- [x] `packages/shared`: domain types, visibility/capability enums, i18n dictionaries (en/es/zh)
- [x] `apps/api`: Hono app, wrangler config, env bindings, local D1, health route
- [x] `apps/web`: Vite React app, design tokens + ported component system
- [x] GitHub repo (public) + periodic commits
- [x] CI: typecheck/test on PR; deploy-on-merge workflow (documented, gated on secrets)

### M1 — Identity core  ◀ this iteration
- [x] Auth: `POST /auth/start` (enumeration-safe), magic link via Resend (stubbed locally), `GET /auth/callback`, `POST /auth/signout`
- [x] Sessions: opaque cookie, 1-year TTL, `last_seen_at` bump, revocable
- [x] `GET /me`: user + controllable persons + active person; `POST /me/active-person`
- [x] Persons & profiles: `GET /persons/:id` (privacy-filtered), `PATCH /persons/:id`, contact items CRUD
- [x] Privacy resolution function (`canSee`) + last-name rule + geo never serialized
- [x] Audit middleware: append-only log on all mutations
- [x] Web: onboarding flow (sign in → check email → signing in → home), Home (layout A), Profile view/edit wired to API
- [x] Control invites: invite co-controller, accept, last-controller guard

### Responsive desktop layouts ◀ shipped
- [x] Desktop shell (244px sidebar nav + sticky header with search/globe/switcher)
- [x] Desktop **Home** (4-up Neighbors row + groups/profile-snapshot rail)
- [x] Desktop **Household/Group detail** (wide member card + 320px contact rail)
- [x] Desktop **Profile** view + edit (within the sidebar shell)
- [x] `useIsDesktop` breakpoint; mobile + desktop share data + sub-components

### M2 — Groups & Shares (in progress)
- [x] Group detail read API (`GET /groups/:id`): members + titles + `is_admin`,
      membership-gated, privacy-filtered group contacts (household cascade read)
- [x] Households + Classrooms detail screens (mobile + desktop), Groups index
- [x] **Shares**: `POST/GET/DELETE /shares` + `GET /shares/targets`; VisibilitySheet
      grantee management (add/remove people & groups) wired live; "Shared · N" chip.
      Verified: a grantee gains visibility, revoke removes it, non-controller 403,
      audit logs share.created/revoked.
- [x] **Group-editing writes** (admin-gated): add/remove members, set title +
      admin flag (last-admin guard), add/edit/delete household contacts.
      `isGroupAdmin` authz (group admin or system admin); candidate search.
      Verified: writes, 403 for non-admins, 409 last-admin guard, audited.
- [x] Capability-gated **creation**: `POST /groups` — any member creates a
      Household (granted household_admin), Teacher capability required for a
      Classroom; creator becomes group admin. "New" flow wired into Groups index.
      Verified: household by non-teacher (201), classroom by non-teacher (403),
      classroom by teacher (201), invalid kind (400).
- [ ] Group-contact per-grantee shares (currently Members/Private only on group items)
- [ ] Field-level shares (e.g. last name) — model supports it; UI not surfaced

### M3 — Neighbors + i18n + offline
- [x] Nominatim geocoding on address mutation: background (waitUntil) geocode of
      person + group addresses, descriptive User-Agent, OSM attribution shown on
      Home. Coords stored server-side, never serialized. Verified end-to-end.
      (Bulk-import deferred ≤1rps queue is M4.)
- [x] `GET /home/neighbors` (haversine ≤2mi, name + approx distance only)
- [x] Language sheet + per-user locale; CJK line-height
- [ ] Service worker (stale-while-revalidate) + IndexedDB mirror; read-only offline mode
      (offline read-only banner + write-disable is wired; SW/IndexedDB cache pending)

### M4 — Bulk import, invitations, masquerade, admin console
- [ ] CSV import with column map + dry-run, idempotent on email
- [ ] Deferred geocode queue for bulk addresses
- [x] **Masquerade** (admin): `POST /admin/masquerade` + `/stop`, short-lived
      masquerade session (effective=target, tagged with acting admin + parent
      session), persistent orange banner with "Return to admin", dual-logged
      (actor=admin, masquerading_as=target). `GET /admin/users` + minimal /admin
      screen to start it. Verified: 403 for non-admins, identity swap, audit,
      stop/restore + session revoke.
- [ ] Admin console: registration toggle, audit log table, invite (CSV)

---

## Conventions
- IDs are **ULIDs** (sortable, URL-safe). Timestamps **ISO-8601 UTC** strings.
- New fields default to `private`; neighbor discovery defaults off (NFR-1).
- All mutating API routes pass through audit middleware.
- UI copy lives in `packages/shared` i18n dictionaries — never hardcoded in components.
- `.dev.vars` holds local secrets (gitignored); `.dev.vars.example` is the template.

## Remote provisioning (run when ready to go live)
See `README.md` → "Deploying to Cloudflare". Not executed in this iteration.
