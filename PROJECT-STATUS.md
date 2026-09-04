# Project status & handoff

Living record of what is built, what is not, and the traps that have already
cost time. `CLAUDE.md` is the specification; this file is the state of play.

**Last updated:** during Phase 3, after custom fields and the workflow builder.

---

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 — Foundations | Auth, tenancy, RLS, CI, billing skeleton, event bus | **Complete** |
| 1 — MVP | Design system, board, tasks, comments, attachments, notifications, reports, settings, members, admin console | **Complete** |
| 2 — V1 | Documents, external portal, Gantt, employees & leave, configurable dashboard | **Complete** |
| 3 — V2 | Commercial, timesheets, revenue, auto-assignment, custom fields, workflows, PDF, Slack | **In progress** |
| 4 — Hardening | Security review, load test, E2E, DR, go-live | Not started |

### Phase 3 detail

| Item | State |
|---|---|
| Commercial documents (5 types, line items, payments, quotation→invoice) | Done |
| Contacts | Done |
| Timesheets (timer, manual entry, weekly submit, approvals) | Done |
| Revenue widgets + hourly rollup refresh | Done |
| Auto-assignment (engine, Inngest job, rules UI) | Done |
| Lead management | **Removed** — built in `00019`, dropped in `00023` at the product owner's direction. See CLAUDE.md §19.3. |
| Custom fields | **Done** — admin UI at Settings → Custom fields, plus `coerceCustomValue` / `validateCustomValue` in `@pm/shared/constants/custom-fields`. **Not yet rendered on task/project forms** — `saveCustomValues` exists and is unused. |
| Workflow builder — **designer** | **Done** — canvas at `/{org}/{workspace}/workflows`, graph model and validation in `@pm/shared/constants/workflows` (21 tests) |
| Workflow builder — **engine** | **NOT BUILT.** Nothing executes a workflow. See below. |
| PDF templates & generation | `pdf_templates` table only; no renderer |
| Slack integration | `integrations` table only; no OAuth, no dispatch |

---

## Verification

Run all of these before calling anything done:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build

# RLS suite — needs the hosted DB and an explicit opt-in
set -a; source apps/web/.env.local; set +a
ALLOW_DESTRUCTIVE_TESTS=true pnpm test:rls
```

Current counts: **187 unit tests, 70 RLS tests, 63 tables, 23 migrations.**

---

## Database

All migrations are applied to the hosted project and recorded in
`supabase_migrations.schema_migrations`. Local and remote are in sync.

```bash
pnpm db:push:dry        # preview
pnpm db:push            # apply
pnpm db:types:offline   # regenerate packages/db/src/types.ts
pnpm db:seed            # two-tenant fixture (node, no psql needed)
pnpm db:check           # verifies schema, RLS, and the JWT hook
pnpm db:migrations      # applied vs pending
```

### Traps already hit — do not rediscover these

1. **Transaction pooler breaks migrations.** `SUPABASE_DB_URL` points at
   Supavisor port 6543 (transaction mode), which is correct for the app but has
   no prepared statements. `supabase db push` fails there with SQLSTATE 42P05.
   `scripts/session-db-url.mjs` swaps to port 5432 and every `db:*` script uses
   it. Do not "fix" this by changing `SUPABASE_DB_URL`.

2. **`array_length()` returns NULL for an empty array**, and a CHECK evaluating
   to NULL is treated as *satisfied*. Two constraints in `00020` silently passed
   for exactly the case they existed to reject. Use `cardinality()`.

3. **Supabase grants SELECT on every new relation in `public`** to `anon` and
   `authenticated` by default. A materialized view cannot carry RLS, so
   `revenue_summary` leaked every tenant's revenue until `00022` revoked it.
   **Any new view or matview must be explicitly revoked.**

4. **Foreign keys to `auth.users` break PostgREST embeds.** A query like
   `profiles!employees_user_id_fkey(...)` fails at *run time* while typecheck
   passes, because the generated types describe a relation to `users`.
   Migrations `00011` and `00021` repoint them at `public.profiles`
   (`profiles.id IS auth.users.id`). **Any new user-referencing column that will
   be embedded must point at `profiles`.** There is a regression test for this
   in `supabase/tests/phase3-rls.test.ts`.

5. **`psql` is keg-only on macOS.** Not on PATH by default; `pnpm db:seed` uses
   a node runner instead so it does not matter.

6. **Migrations are never edited after applying.** Reverse them with a new one
   (see `00023` dropping the leads module).

---

## Architecture notes that are easy to get wrong

- **Money and totals are database-derived.** `commercial_line_items.line_total`
  comes from a BEFORE trigger; the four document totals from an AFTER trigger.
  Both are `SECURITY DEFINER` with the columns revoked from end-user roles.
  Client-supplied totals are stripped by the Zod schemas. The same arithmetic is
  mirrored in `@pm/shared/utils/currency` for the live preview only.
- **Leave balances** are maintained by `sync_leave_balance`; overlapping leave is
  blocked by a `btree_gist` exclusion constraint, not by application checks.
- **One running timer per person** is a partial unique index, not app logic.
- **Kanban column owns status** (§18 rule 3). There is no status-only write path.
- **Document numbers** come from `next_doc_number()`, which increments under a
  row lock. Numbers are never recycled — drafts delete, issued documents void.
- **RLS cannot express "not yourself"**, so self-approval guards (leave,
  timesheets) live in the server actions and are documented there.
- **Portal users hold no `org_id` claim**, so every org-scoped policy denies them
  by default. Their access is solely `portal_project_access`.
- **Custom field values share one `jsonb` column** across every field type, so
  the field's `field_type` is the only thing that says how to read a value.
  Coerce and validate through `@pm/shared/constants/custom-fields`; never trust
  the raw blob. A field's type and entity are immutable after creation because
  existing values are stored in the old type's shape.

---

## Background jobs (Inngest)

Registered at `apps/web/src/app/api/inngest/route.ts`:

| Function | Schedule | Purpose |
|---|---|---|
| `deliverNotificationEmails` | every 5 min | Emails unsent notifications, honouring quiet hours and digest mode |
| `sendDailyDigests` | hourly | Digest for non-instant subscribers |
| `flagOverdueTasks` | hourly | Creates overdue notifications, once per task per day |
| `refreshRevenueSummary` | hourly | `REFRESH MATERIALIZED VIEW CONCURRENTLY` |
| `applyAutoAssignment` | every 2 min | Applies assignment rules to unassigned tasks |

**None of these have been run.** They need `INNGEST_SIGNING_KEY` /
`INNGEST_EVENT_KEY` set and the app registered with Inngest. The pure logic they
call is unit-tested (`auto-assign.test.ts`, `notifications.test.ts`); the jobs
themselves are not.

---

## The workflow engine — the next substantial piece

Everything around it exists; the runner does not.

**Built:** `workflows` / `workflow_runs` / `workflow_step_logs` tables, the graph
model (`parseGraph`, `validateGraph`, `findCycles`, `reachableFrom`,
`executionOrder`), the visual canvas, and save/activate actions that refuse to
activate an invalid graph.

**Missing:** an Inngest function that, given a trigger event, walks the graph and
performs the actions. `CLAUDE.md` §11 sketches it. Notes for whoever builds it:

- Triggers come from the `events` table, written by the `emit_event` database
  trigger. Inngest cannot be called from Postgres, so the dispatcher must poll —
  the same shape as `applyAutoAssignment`. Do **not** use `events.processed` as
  the cursor without checking who else reads it (§12 integration dispatch is
  meant to as well).
- `executionOrder()` gives the walk order. Condition nodes branch on edge label
  (`yes` / `no`); a `branch` node fans out on its own labels.
- Enforce `WORKFLOW_LIMITS` (50 steps, 5 min, 3 retries) in the runner. The step
  cap is a **cost guard**, not a correctness check — cycles are already refused
  at save time by `findCycles`.
- Write a `workflow_runs` row per run and a `workflow_step_logs` row per node,
  and bump `run_count` / `last_run_at` (there is already a
  `bump_workflow_run_stats` trigger for that — check before doing it by hand).
- Action types are listed in `WORKFLOW_ACTION_TYPES`; the canvas can already
  select all of them, so each needs an implementation or an explicit refusal.
- The workflow detail page carries a visible note saying the engine does not
  exist. **Remove it when the engine lands.**

---

## Known gaps beyond Phase 3

- **No E2E tests.** Playwright is specified in §14 and not installed.
- **No `deploy.yml`.** CI runs lint/typecheck/test/RLS/build only.
- **Only `en.json`.** Nine locales are specified in §21; the scaffolding is
  there and `pnpm i18n:check` guards completeness.
- **§13 items outstanding:** magic-byte MIME sniffing, virus scanning, EXIF
  stripping, session-management UI, MFA.
- **`ALLOW_DESTRUCTIVE_TESTS`** — the RLS suite refuses non-local databases
  without it. CI runs against local Supabase so it is not needed there.

---

## Conventions

- Server actions return `ActionResult<T>`; errors go through `toActionError`.
- Every mutating action re-checks permission with `assertCan` even when the UI
  hides the control — hiding is presentation, not access control.
- Rich text is sanitized **before storage**, never on render.
- Dates are `yyyy-MM-dd` strings compared as strings; "today" is resolved in the
  organization's timezone via `todayIn(auth.orgTimezone)`.
- PostgREST returns a to-one embed as an object but the generated types allow an
  array — normalise, never cast.
- New UI uses the Vektra tokens in `packages/ui/src/styles.css`. Meta text uses
  `.label-meta`. There is no light-mode-only styling.
