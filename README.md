# Project Management SaaS

Multi-tenant, subscription-based project management platform.
`claude.md` is the specification and the source of truth; this file covers how to
run what exists today.

## Status

**Phase 0 (Foundations) and Phase 1 (MVP) are complete.** See [Build order](#build-order).

The UI follows the Vektra design system: dark-first tokens in
`packages/ui/src/styles.css`, a monospace "meta" type treatment for every id,
count and status label, and a four-step surface elevation ladder.

| Area | State |
|---|---|
| Monorepo, Turborepo, TypeScript strict | Done |
| Database schema (52 tables, 15 migrations) | Done |
| RLS policies (121) | Done, 31 isolation tests passing |
| Auth: signup, login, reset, callback, onboarding | Done |
| Event bus (`emit_event` triggers) | Done |
| Stripe billing skeleton + webhook | Done |
| Design system (`packages/ui`, 24 components) | Done |
| App shell: sidebar, topbar, search, theme toggle | Done |
| Projects, tasks, subtasks | Done |
| Kanban board + drag-drop + WIP limits | Done |
| Saved Kanban views (§19.8) — group, sort, card fields | Done |
| Quick capture (`@user #label !priority ~pts fri`) | Done |
| Board filters (URL-driven), blocked detection, points meter | Done |
| Comments + task descriptions (Tiptap) | Done |
| Attachments (Storage, signed URLs) | Done |
| Notifications: in-app + email (Resend) + digests | Done |
| Background jobs (Inngest): delivery, digests, overdue scan | Done |
| Task report (§19.7 columns, filters) | Done |
| Dashboard widgets, My tasks, cross-project search | Done |
| Org settings, workspaces, members + invites, roles matrix | Done |
| Admin console: orgs, users, subscriptions, notices, flags, audit, health | Done |
| Gantt, documents, portal, commercial, workflows | Not started — Phase 2+ |

### Configuration added in Phase 1

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` enable notification email; without them
the app degrades to in-app notifications only rather than erroring.
`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` enable the background jobs served at
`/api/inngest`.

## Prerequisites

- Node.js 20+
- pnpm 9+ (`corepack enable pnpm`)

Docker is **not** required. Development runs against a hosted Supabase project;
running the full local stack costs 12 containers and roughly 1 GB of RAM, which
is more than a laptop can spare while also running an editor and two Next apps.
The local path still works if you want it (`pnpm db:local`).

## Getting started

```bash
pnpm install

# One-time: authenticate the CLI and point it at your project.
# Credentials are stored under ~/.supabase, never in the repo.
npx supabase login
pnpm db:link                    # asks for the project ref + database password

cp .env.example apps/web/.env.local
cp .env.example apps/admin/.env.local
# Fill in the four Supabase values — see the comments in .env.example

pnpm db:push                    # applies supabase/migrations/* to the project
pnpm db:seed                    # loads the two-tenant development fixture
pnpm db:types                   # regenerates packages/db/src/types.ts

pnpm db:check                   # verifies the project is wired correctly
pnpm dev:web                    # http://localhost:3000
```

### The one step that is easy to miss

`supabase/config.toml` configures the custom JWT hook for **local development
only**. On a hosted project you must enable it yourself:

> Dashboard → Authentication → Hooks → *Customize Access Token (JWT) Claims*
> → enable → select `public.custom_access_token_hook`

Without it, access tokens carry no `org_id`, `auth.org_id()` returns NULL, and
**every RLS policy denies** — the app looks broken while the database is fine.
`pnpm db:check` signs in and inspects a real token, so it catches this directly
rather than leaving you to guess.

### Seeded accounts

All use the password `password123`.

| Email | Role | Organization |
|---|---|---|
| `owner@acme.test` | owner | Acme (Growth plan) |
| `manager@acme.test` | manager | Acme |
| `member@acme.test` | member | Acme |
| `owner@globex.test` | owner | Globex (Starter plan) |
| `client@external.test` | portal user | Acme, one project only |

Acme and Globex exist specifically so the RLS tests can prove a user in one
tenant cannot reach the other.

### Working on a low-memory machine

Turborepo defaults to 10 parallel tasks; each `tsc` or `next build` wants
300–600 MB, so the default alone can exceed available RAM on an 8 GB machine.
The scripts cap concurrency at 2, and `pnpm verify` runs everything strictly
serially. Prefer `pnpm dev:web` over `pnpm dev` unless you need both apps.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Both apps via Turborepo |
| `pnpm build` | Production build of everything |
| `pnpm lint` / `pnpm typecheck` | Zero-warning gates |
| `pnpm test` | Unit tests (validators, RBAC, money maths, slugs) |
| `pnpm test:rls` | Tenant isolation tests against a live database |
| `pnpm db:reset` | Re-apply all migrations and reseed |
| `pnpm db:types` | Regenerate `packages/db/src/types.ts` (needs Docker) |
| `pnpm db:types:offline` | Same, from any `SUPABASE_DB_URL` — no Docker |
| `pnpm i18n:check` | Fail if a locale is missing a key from `en.json` |

## Layout

```
apps/
  web/        Customer app     — auth, onboarding, dashboard, billing
  admin/      Admin portal     — tenant list, operator auth
packages/
  shared/     Constants, Zod validators, types, formatters, money maths
  auth/       Permission matrix, JWT claims, middleware helpers
  db/         Generated types, typed queries, PostgREST helpers
  ui/         shadcn-style components on the shared Tailwind preset
  eslint-config/
supabase/
  migrations/ 00001-00009, applied in order
  tests/      RLS isolation suite
  seed.sql    Two-tenant development fixture
scripts/
  gen-types.mjs         Offline type generator (no Docker)
  check-translations.mjs
```

## Security model

Tenant isolation is enforced in six layers (`claude.md` §22.4). The one that
matters is the database: **every** table has RLS enabled, and policies filter on
`organization_id = auth.org_id()` rather than joining through parents.

Two properties worth knowing when editing the schema:

- **Column-level `REVOKE` does nothing on its own.** Postgres checks the
  table-level grant first, so a table-wide `GRANT UPDATE` silently overrides any
  per-column revoke. `grant_columns_except()` in `00009` withholds the table
  grant and re-grants the permitted columns. This is what actually keeps
  `tasks.task_number`, the derived money totals, and the OAuth token columns off
  limits.
- **Trigger functions that do system bookkeeping are `SECURITY DEFINER`.**
  Otherwise RLS blocks the database's own maintenance writes — for example, the
  task-numbering trigger updates a counter on `projects`, which a plain member
  is not allowed to update, so task creation would fail for them.

Run `pnpm test:rls` after any schema change. It asserts, among other things,
that no table is left without RLS and that no RLS-enabled table has zero
policies.

### Seeding auth users

`supabase/seed.sql` writes directly into `auth.users`, which has one trap:
GoTrue scans `confirmation_token`, `recovery_token`, `email_change_token_new`
and `email_change` into non-nullable Go strings, but those four columns are
nullable with no default. Leaving them NULL makes every login fail with a
generic `500 Database error querying schema` — the real cause only appears in
`docker logs supabase_auth_<project>`. The seed sets them to `''` and also
creates the `auth.identities` rows a real signup would.

## Build order

Per `claude.md` §20:

| Phase | Contents | State |
|---|---|---|
| 0. Foundations | Auth, tenancy, RLS, CI, billing skeleton, event system | **Done** |
| 1. MVP | Projects, tasks, subtasks, Kanban, comments, task report | Next |
| 2. V1 | Subtask Kanban, Gantt, documents, portal, dashboards, HR | |
| 3. V2 | Commercial docs, timesheets, CRM, workflows, integrations | |
| 4. Hardening | Security review, load testing, DR drill, go-live | |

The schema for later phases is already migrated, so those phases are UI and
service-layer work rather than database work.

## Notes on deviations from `claude.md`

- `next.config.mjs`, not `.ts` — Next 14 does not support a TypeScript config
  file. Revisit on the Next 15 upgrade.
- Migrations `00001`-`00009` follow the specified names. The `§19` modules (CRM,
  HR, timesheets, saved views) are **not** yet migrated and will land as
  `00010`+ in their phases.
- `set_task_number()` uses an atomic counter on `projects` instead of
  `MAX(task_number) + 1`, which races under concurrent inserts and would violate
  business rule 1.
- `emit_event()` publishes semantic names (`task.created`, `task.status_changed`)
  rather than raw `table.operation` pairs, matching the event vocabulary in
  `§16` and `packages/shared/src/constants/events.ts`.

## Type generation

`packages/db/src/types.ts` is generated, never hand-edited — anything written
into it is lost on the next run. Hand-written aliases belong in
`packages/db/src/index.ts`.

`pnpm db:types` (the official CLI) is the source of truth and is what CI
compares against. `pnpm db:types:offline` is a fallback for when Docker is
unavailable; it introspects any `SUPABASE_DB_URL` directly. The two were
diffed across all 51 tables and agree on every column type, so the fallback is
safe to use — but if they ever disagree, the official output wins.
# vektra-project
# vektra-project
# vektra-project
