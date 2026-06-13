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
- [x] `useIsDesktop` breakpoint; mobile + desktop share data + sub-components

### M2 — Groups (partially started)
- [x] Group detail read API (`GET /groups/:id`): members + titles + `is_admin`,
      membership-gated, privacy-filtered group contacts (household cascade read)
- [x] Households + Classrooms detail screens (mobile + desktop), Groups index
- [ ] Editing: household contact info, classroom roster/title management (writes)
- [ ] Shares: grant a private field/contact item to Person/Group; VisibilitySheet grantee mgmt
- [ ] Capability-gated write tools (Teacher tools, Household admin tools)

### M3 — Neighbors + i18n + offline
- [ ] Nominatim geocoding on address mutation (single-flight ≤1 rps, UA/attribution)
- [ ] `GET /home/neighbors` (haversine ≤2mi, name + approx distance only)
- [ ] Language sheet + per-user locale; CJK line-height
- [ ] Service worker (stale-while-revalidate) + IndexedDB mirror; read-only offline mode

### M4 — Bulk import, invitations, masquerade, admin console
- [ ] CSV import with column map + dry-run, idempotent on email
- [ ] Deferred geocode queue for bulk addresses
- [ ] Masquerade (admin) + persistent banner, double-logged
- [ ] Admin console: registration toggle, audit log table, invite

---

## Conventions
- IDs are **ULIDs** (sortable, URL-safe). Timestamps **ISO-8601 UTC** strings.
- New fields default to `private`; neighbor discovery defaults off (NFR-1).
- All mutating API routes pass through audit middleware.
- UI copy lives in `packages/shared` i18n dictionaries — never hardcoded in components.
- `.dev.vars` holds local secrets (gitignored); `.dev.vars.example` is the template.

## Remote provisioning (run when ready to go live)
See `README.md` → "Deploying to Cloudflare". Not executed in this iteration.
