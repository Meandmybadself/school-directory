# Eisenhower School Directory

A privacy-conscious, **members-only** contact directory for a single school
community — teachers, staff, parents, and students. People sign in with **email
only** (magic link) and act on behalf of one or more **Persons** they control
(themselves and their children). Nothing in the product is world-readable;
"Public" means *visible to authenticated members of this instance* and nothing
stronger.

> Single-tenant: one school per deployment. Built to run on Cloudflare's free tier.

## Status

Iteration 1 — **scaffold + M1 identity core**. See [`PLAN.md`](./PLAN.md) for the
milestone breakdown and what's done vs. pending. Product spec lives in
[`docs/`](./docs) (read `00-PLAN` → `01-SRD` → `02-SDD`). The hi-fi design board
is in [`design_handoff_school_directory/`](./design_handoff_school_directory)
(reference only — ported into the app, not shipped).

## Architecture

| Package | Stack | Role |
|---|---|---|
| `apps/web` | React + Vite → Cloudflare **Pages** | SPA: design system, screens, i18n, offline cache |
| `apps/api` | Hono on Cloudflare **Workers** | Auth, authz, **server-side privacy resolution**, audit, geocoding |
| `packages/shared` | TypeScript | Domain types + i18n dictionaries (en/es/zh) shared by web & api |
| `apps/api/migrations` | SQL | Cloudflare **D1** (SQLite) schema |

**Identity model:** `User` (credential) ─< `Control` >─ `Person` (directory entity)
─< `Membership` >─ `Group`. A Person can have several Controllers (two parents);
students are Persons with no User. Privacy is resolved **only on the server** —
clients never receive data they can't see, and geo-coordinates are never
serialized.

```
React SPA (Pages)  ──fetch (JSON, session cookie)──▶  Hono API (Workers)
  cache-first SW + IndexedDB                            │  session + audit middleware
                                                        ├─ D1 (SQL)
                                                        ├─ R2 (photos)
                                                        ├─ Resend (email)
                                                        └─ Nominatim (geocode, server-only)
```

## Prerequisites

- Node ≥ 22, [pnpm](https://pnpm.io) 10
- A Cloudflare account + [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) (for deploy)

## Quick start (local)

```bash
pnpm install

# API: copy local secrets template (magic links print to the console if no Resend key)
cp apps/api/.dev.vars.example apps/api/.dev.vars

# Create the local D1 database + apply migrations, then seed demo data
pnpm db:migrate:local
pnpm db:seed:local

# Run web (5173) + api (8787) together
pnpm dev
```

Then open <http://localhost:5173>, enter `dana@eisenhower.edu`, and **read the
API terminal** — the magic-link URL is printed there (no email is sent without a
Resend key). Click it to land in the directory.

## Useful scripts

| Command | What |
|---|---|
| `pnpm dev` | Run web + api in parallel |
| `pnpm dev:web` / `pnpm dev:api` | Run one app |
| `pnpm typecheck` | Typecheck every package |
| `pnpm test` | Run unit tests |
| `pnpm db:migrate:local` | Apply D1 migrations to the local SQLite |
| `pnpm db:seed:local` | Load demo data |

## Deploying to Cloudflare

Not executed in this iteration — these are the commands to go live:

```bash
# 1. Create remote resources (run once)
cd apps/api
wrangler d1 create school-directory          # paste database_id into wrangler.toml
wrangler r2 bucket create school-directory-photos

# 2. Apply migrations to the remote D1
wrangler d1 migrations apply school-directory --remote

# 3. Set secrets
wrangler secret put RESEND_API_KEY
wrangler secret put EMAIL_FROM

# 4. Set the bootstrap admin(s) in wrangler.toml [vars] BEFORE deploying:
#    BOOTSTRAP_ADMIN_EMAILS = "office@school.edu"

# 5. Deploy the Worker, then the Pages app
wrangler deploy
cd ../web && pnpm build && wrangler pages deploy dist --project-name school-directory
```

CI (`.github/workflows/`) typechecks + tests on PRs and deploys on merge to
`main` once the repository secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
are configured.

### First-run setup (bootstrapping a bare instance)

A fresh database has **no users** and ships with **registration closed**
(migration `0004`). The first admin is bootstrapped by config, not by signing up:

1. Set `BOOTSTRAP_ADMIN_EMAILS` in `apps/api/wrangler.toml` `[vars]` to the
   office/operator email(s), comma-separated, **before deploying**. These
   accounts can sign in even while registration is closed and are granted
   `system_admin` on sign-in (re-granted each time, so you can add admins later).
2. Deploy + apply migrations.
3. That email signs in at the app → it becomes an admin.
4. From **Admin**, bulk-import the roster (which queues invitations), and/or open
   registration if you want families to self-onboard.

There is intentionally **no "first user becomes admin"** auto-promotion — with
open registration that would be a footgun. Without a configured bootstrap email
on a closed instance, no one can sign in (by design); set the var to recover.
Local dev keeps registration open and seeds an admin (`dana@eisenhower.edu`).

## Privacy posture (load-bearing)

- New fields default to **private**; neighbor discovery is **opt-in** and
  independent of address visibility.
- The **offline cache** holds only data the User can already see, treated like a
  phone's contacts list — purged on signout. No client-side encryption in v1.
- Magic-link tokens are single-use, short-lived, stored hashed. Sessions are
  long-lived but server-revocable.
- The audit log is append-only and hash-chained for tamper evidence.

## License

MIT
