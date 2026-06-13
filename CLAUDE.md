# CLAUDE.md — working notes for agents in this repo

Read this before making changes. It captures the non-obvious rules; the product
spec is in `docs/` and the engineering plan in `PLAN.md`.

## What this is

Single-tenant, members-only **school directory**. Identity foundation for later
services. Cloudflare-native: React/Vite (Pages) + Hono (Workers) + D1 + R2,
Resend email, Nominatim geocoding.

## Repository layout

```
apps/web            React SPA (Vite). Ported design system in src/components, screens in src/screens.
apps/api            Hono Worker. Routes in src/routes, shared logic in src/lib, middleware in src/middleware.
apps/api/migrations Ordered D1 SQL migrations (NNNN_name.sql). Never edit an applied migration — add a new one.
packages/shared     Domain types (types.ts) + i18n dictionaries (i18n.ts). Imported as `@sd/shared`.
docs/               Product spec (PLAN/SRD/SDD). Source of truth for requirements.
design_handoff_*/   Hi-fi design reference. NOT a build target — port, don't ship.
```

## Non-negotiable invariants

1. **Privacy is resolved server-side only.** Never send a client data it can't
   see. All filtering lives in `apps/api/src/lib/privacy.ts` + `serialize.ts`.
2. **Geo-coordinates never leave the server.** `geo_lat`/`geo_lng` are never put
   in any DTO. Neighbor responses carry a rounded distance string only.
3. **New fields default to `private`** (NFR-1). Neighbor discovery is opt-in and
   independent of address visibility.
4. **No account enumeration.** `/auth/start` and registration-closed responses
   are identical whether or not the email exists.
5. **All mutating routes push audit drafts** to `c.var.audit`; the audit
   middleware persists them (hash-chained). Don't write `audit_log` directly.
6. **UI copy comes from `@sd/shared` i18n dictionaries** — never hardcode user-
   facing English in a component. Member-entered content is never translated.
7. **IDs are ULIDs** (`lib/ids.ts`); timestamps are ISO-8601 UTC strings.

## Conventions

- TypeScript strict everywhere. `verbatimModuleSyntax` is on — use
  `import type { … }` for type-only imports and `.js` extensions on relative
  imports (NodeNext/bundler ESM).
- D1 access is raw prepared statements (ORM-agnostic per the SDD). Use `.bind()`,
  never string-interpolate values into SQL.
- Design tokens are CSS variables under the `.sd` scope (see `apps/web`), matching
  the handoff exactly: `--blue #0068A8`, `--orange #FAAB1C`, etc.
- Visibility chip states: `members` (blue) / `private` (slate) / `shared` (orange).
  There is **no public state** anywhere in the UI.

## Local dev

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm db:migrate:local && pnpm db:seed:local
pnpm dev          # web :5173, api :8787
```

Magic links print to the **API console** when `RESEND_API_KEY` is empty. Demo
login: `dana@eisenhower.edu`.

## When adding a migration

Create `apps/api/migrations/NNNN_description.sql` (next number). Update
`packages/shared/src/types.ts` if the wire shape changes. Re-run
`pnpm db:migrate:local`.

## Commit / PR

- Conventional-ish messages; keep commits scoped to one concern.
- CI must pass `pnpm typecheck` and `pnpm test`. Deploy happens on merge to `main`.
