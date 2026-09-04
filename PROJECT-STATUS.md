# Project status & handoff

Living record of what is built, what is not, and the traps that have already
cost time. `CLAUDE.md` is the specification; this file is the state of play.

**Last updated:** end of Phase 3. Phases 0-3 are complete; Phase 4 has not
started.

---

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 — Foundations | Auth, tenancy, RLS, CI, billing skeleton, event bus | **Complete** |
| 1 — MVP | Design system, board, tasks, comments, attachments, notifications, reports, settings, members, admin console | **Complete** |
| 2 — V1 | Documents, external portal, Gantt, employees & leave, configurable dashboard | **Incomplete** — two spec items missing, below |
| 3 — V2 | Commercial, timesheets, revenue, auto-assignment, custom fields, workflows, PDF, Slack | **Complete** |
| 4 — Hardening | Security review, load test, E2E, DR, go-live | **Not started** — plan below |

### Phase 2 — what is actually missing

Audited against CLAUDE.md §20, which lists for Phase 2: *"Subtask Kanban, Gantt
chart, documents, import/export, external portal, customizable dashboard (grid
layout + widget catalog), email integration, contacts, employee management,
leave tracking."*

Eight of ten are built. Two are not, and this file previously claimed the phase
was complete, which was wrong:

| Missing item | State |
|---|---|
| **Subtask Kanban** | Subtasks render as a checklist (`components/tasks/subtask-list.tsx`). The schema supports a subtask-level board — `kanban_boards.task_id` exists with a CHECK making it exclusive with `project_id` — and `PLAN_LIMITS.subtask_kanban` gates it as a Growth feature, but nothing reads or writes those rows. §4 and §10 both name a `subtask-board.tsx` that does not exist. |
| **Import / export** | Nothing at all. `import_export_jobs` (00007) has never been read or written; there is no CSV surface anywhere in either app. §14 and §20 both call for it, and §13.7 already defines an `export` rate limiter for it. |

Neither blocks Phase 3, which is why it went unnoticed: both are self-contained
features rather than foundations anything else builds on.

### Phase 3 detail

| Item | State |
|---|---|
| Commercial documents (5 types, line items, payments, quotation→invoice) | Done |
| Contacts | Done |
| Timesheets (timer, manual entry, weekly submit, approvals) | Done |
| Revenue widgets + hourly rollup refresh | Done |
| Auto-assignment (engine, Inngest job, rules UI) | Done |
| Custom fields | Done — definable for four entity types and rendered on all four |
| Workflow builder — designer | Done |
| Workflow builder — engine | Done — all six gaps closed, see below |
| PDF generation + templates | Done — template-driven, with a live editor |
| Audit log | Done — admin console and a customer-facing viewer |
| Slack integration + §12 dispatcher | Done |
| Lead management | **Removed** — built in `00019`, dropped in `00023` at the product owner's direction. See CLAUDE.md §19.3. |

---

## Verification

Run all of these before calling anything done:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build

# RLS suite — needs the hosted DB and an explicit opt-in
set -a; source apps/web/.env.local; set +a
ALLOW_DESTRUCTIVE_TESTS=true pnpm test:rls
```

Current counts: **342 unit tests, 70 RLS tests, 62 tables, 139 RLS policies
across all 62, 27 migrations, 9 background jobs.**

The RLS suite has NOT been re-run since migrations 00025-00027. Do that before
trusting the isolation guarantees — 00025 changed the comments INSERT policies
and 00027 added a table.

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

6. **Seed addresses are `@*.test`, which can never receive mail.** A provider
   accepts such a message and hard-bounces it later, so the app records a
   successful send while the sending domain's reputation degrades. `sendEmail`
   refuses reserved TLDs via `lib/email/address.ts` — do not remove that guard
   to "test email properly"; point the seed at a real domain instead.

7. **Migrations are never edited after applying.** Reverse them with a new one
   (see `00023` dropping the leads module).

8. **A function cannot cross the RSC boundary.** The sidebar passed Lucide
   icon *components* from a server component to a client one; every page in the
   org shell 500'd with "Functions cannot be passed directly to Client
   Components". Icons now cross as names. `tsc` and ESLint both pass on the
   broken version.

9. **The RSC client manifest is built from named exports.** A component
   attached as a static property (`AuditFilters.Pager = ...`) cannot be
   resolved when a server component renders it — "Could not find the module …
   in the React Client Manifest", again only at request time.

10. **Column-level `REVOKE` is a no-op against a table-level `GRANT`.**
    Supabase grants `SELECT` on the whole table to `authenticated`, so
    `REVOKE SELECT (col)` silently changes nothing. Revoking the table grant and
    re-granting per column works but leaves a worse trap: every column a later
    migration adds is then unreadable until someone remembers to grant it. For a
    secret, store a hash instead (see `webhook_token_hash` in `00025`).

11. **`SET search_path = public` breaks pgcrypto.** Supabase installs it into
    `extensions`, so a `SECURITY DEFINER` function pinned to `public` alone
    cannot resolve `pgp_sym_encrypt` — and fails at call time, not at creation.
    Pin to `public, extensions`.

12. **The database already maintains some counters.** `workflows.run_count` and
    `last_run_at` come from the `bump_workflow_run_stats` trigger (`00005`). A
    second write from the engine double-counted every run and raced besides.
    Check for a trigger before adding bookkeeping.

13. **`server-only` makes a module unimportable from vitest.** Hit four times
    now. When a `server-only` module contains pure logic worth testing —
    especially a security check — extract it to an unmarked sibling and re-export
    (`ssrf.ts`, `slack-text.ts`, `signature.ts`, `logo-origin.ts`).

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
| `deliverNotificationEmails` | every 5 min | Emails unsent notifications, honouring quiet hours and digest mode. Refuses undeliverable domains. |
| `sendDailyDigests` | hourly | Digest for non-instant subscribers |
| `flagOverdueTasks` | hourly | Creates overdue notifications, once per task per day |
| `refreshRevenueSummary` | hourly | `REFRESH MATERIALIZED VIEW CONCURRENTLY` |
| `applyAutoAssignment` | every 2 min | Applies assignment rules to unassigned tasks |
| `dispatchWorkflows` | every 2 min | Matches events to workflows and enqueues `workflow/run` |
| `runScheduledWorkflows` | every 5 min | Fires schedule-triggered workflows whose slot has come |
| `executeWorkflow` | on `workflow/run` | Executes one run; sleeps across delay nodes |
| `dispatchIntegrationEvents` | every 2 min | Slack + outbound webhooks (§12) |

**Local development needs no keys.** Run the app, then
`npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` and open
http://127.0.0.1:8288 to invoke functions by hand and inspect each step.
`/api/inngest` reports `{"mode":"dev","function_count":9}` when it is wired up.

**Observed running end to end:** `deliverNotificationEmails` (against seeded
data), `refreshRevenueSummary` (via the service-role RPC),
`runScheduledWorkflows`, `executeWorkflow` (webhook trigger through a real 5s
delay to an action), and `dispatchIntegrationEvents` (webhook delivery refused
by the SSRF guard, event marked processed).

**Not yet exercised:** `sendDailyDigests`, `flagOverdueTasks`,
`applyAutoAssignment`, `dispatchWorkflows`. Their logic is unit-tested; the
Inngest wiring around them is not.

**In production the signing key is the only thing authenticating
`/api/inngest`** — that route is excluded from the auth middleware because
Inngest calls it machine-to-machine. Do not deploy the jobs without it.

---

## The workflow engine

Every node and action type in the designer now does something at run time.

**Shape.** `dispatchWorkflows` (2 min) matches events to workflows and enqueues;
`runScheduledWorkflows` (5 min) does the same for schedule triggers;
`/api/webhooks/workflows/{token}` does it for inbound calls. All three fan into
one `workflow/run` Inngest event handled by `executeWorkflow`, which is the only
thing that executes a graph. That split is what makes delays possible — a poll
cannot wait three days for a workflow to finish, but a durable function can.

**Delays** are `step.sleep`. A run genuinely suspends and resumes, surviving a
deploy. Note the two budgets measure different things: `MAX_STEPS` (50) bounds
the walk, `MAX_RUNTIME_MS` (5 min) bounds COMPUTE only — time asleep does not
count against it, or "wait a day, then act" would be illegal by construction.

**Idempotency** is unchanged: the unique index from `00024` on
`(workflow_id, trigger_data->>'event_id')` means a redelivered event exits at
the claim step. `events.processed` is deliberately NOT the workflow cursor —
it belongs to the §12 integration dispatcher, which does own it.

**Schedules** are stored structurally in `trigger_config` and evaluated in the
organisation's timezone (§21.6); `cron_expression` is derived for display. The
occupancy *slot key*, not elapsed time, prevents a double fire — comparing
elapsed time would let a late poll push every subsequent run later, forever.
DST is covered by tests, both directions.

**Webhook triggers** are addressed by a token stored as a SHA-256 hash. The
plaintext is shown once, at mint or rotation. Every failure mode on that route
answers 202 identically, so it cannot be used as an oracle for guessing tokens.

**`call_webhook`** goes through `callWebhook`, which is the single guarded
outbound path: scheme, port, and every resolved address checked against private
ranges, redirects followed by hand and re-validated at each hop. DNS rebinding
is not fully closed — between our lookup and the socket's own lookup a record
can change. Closing it needs a pinned-IP agent. **Do not add a bare `fetch` to
a customer-supplied URL anywhere;** that mistake was made once already, in the
integration dispatcher, and only a test caught it.

**`add_comment`** works because `00025` gave comments an `author_type`. A
workflow comment has `author_id IS NULL` and renders as automation rather than
impersonating a person or occupying a member seat. Automated comments are
internal by default so portal users do not see internal chatter.

**Branches** are switches: exactly one outgoing edge is taken, chosen by the
configured field with a `default` fallback. They previously fanned out on every
edge, which turned a three-way routing decision into three simultaneous actions.

### Still true / worth knowing

- `update_fields` restricts writes to `status`, `priority`, `is_milestone`. An
  arbitrary column name from a config blob is a write primitive.
- `create_task` goes through the task service, so it cannot bypass the plan
  limit or the column-owns-status rule, and it verifies the project is in the
  workflow's own org — the runner holds the service role and bypasses RLS, so
  nothing else would stop a cross-tenant write.
- Manual triggers exist in the schema and the designer but have no "run now"
  button. That is the one trigger type with no way to fire it.

---

## Integration dispatch (§12)

`dispatchIntegrationEvents` (2 min) reads unprocessed events and fans out to
connected integrations and outbound webhook endpoints.

- **Cursor:** `events.processed`, marked *after* delivery. Marked before, a
  failure would lose events outright; marked after, the worst case is a
  duplicate the unique index already refuses.
- **At-most-once per destination per event**, enforced by
  `idx_integration_deliveries_once` rather than by care. For a notification a
  missed message beats a duplicated one.
- **Slack tokens** are encrypted in Postgres (`save_integration`) and read only
  by the dispatcher through a service-role RPC. Rotating
  `INTEGRATION_ENCRYPTION_KEY` orphans every stored token — the dispatcher marks
  those integrations errored and they must be reconnected. **There is no
  re-encryption path; write one before rotating in production.**
- **Outbound webhooks** are signed `sha256={hmac}` over `{timestamp}.{body}`.
  That is a published contract — changing the construction breaks every
  receiver built on it.
- Slack message text is escaped: a task titled `<!channel>` would otherwise ping
  the whole workspace.

## Phase 4 — hardening. Start here.

Nothing below is started. Ordered by what blocks a go-live decision, not by
size.

### 1. Re-run and extend the RLS suite  *(blocking)*

```bash
set -a; source apps/web/.env.local; set +a
ALLOW_DESTRUCTIVE_TESTS=true pnpm test:rls
```

It has not run since `00025`, which rewrote the comments INSERT policies, or
`00027`, which added `integration_deliveries`. Isolation for those is currently
asserted by reading the SQL, not by a test. Add coverage for:

- `comments.author_type` — a member must not be able to insert a comment
  claiming `author_type = 'workflow'`. The CHECK makes it impossible today;
  prove it rather than trusting the derivation.
- `integration_deliveries` — admin-read only, no cross-tenant read.
- `workflows.webhook_token_hash` — a member can read the row; confirm the hash
  is useless to them (it is, but the test documents the intent).
- `pdf_templates` — manager-gated, no cross-tenant read.

### 2. E2E tests (Playwright)  *(blocking)*

§14 names four flows: auth, task lifecycle, commercial, portal. Not installed
at all. This is the largest single gap — every verification in this project so
far has been a curl against a rendered page, which catches 500s and missing
content but not interaction.

Two bugs this quarter were invisible to `tsc`, ESLint AND the unit suite, and
only appeared on a real request: the sidebar passing a function across the RSC
boundary, and `AuditFilters.Pager` not resolving from the client manifest.
**A green CI run currently proves less than it looks like it does.** That is the
argument for Playwright, and it is worth making explicitly to whoever schedules
this.

### 3. Outstanding §13 items  *(blocking for a security review)*

| Item | State |
|---|---|
| Magic-byte MIME sniffing on upload | Not done — MIME is taken from the client |
| Virus scanning | Not done |
| EXIF stripping / image re-encode | Not done |
| Session management UI (list, revoke) | Not done — `user_sessions` exists |
| MFA (TOTP) | Not done |
| DNS-rebinding-proof outbound calls | Not done — needs a pinned-IP agent |
| Integration key rotation path | Not done — rotating orphans every token |

### 4. Deployment  *(blocking)*

- No `deploy.yml`. CI runs lint/typecheck/test/RLS/build and stops.
- §15 describes preview → staging → production with a gated prod deploy. None
  of it exists.
- Backup/restore has never been tested. PITR being enabled is not the same as
  knowing a restore works.

### 5. Load testing

§20 names k6 against RLS-heavy queries. Nothing measured. The queries most
worth testing are the ones where RLS calls a `SECURITY DEFINER` helper per row:
`is_project_member`, `portal_can_access_task`.

### 6. Finish Phase 2 first

Two Phase 2 items are unbuilt (see "Phase 2 — what is actually missing" above):
subtask Kanban and import/export. They are product scope, not hardening, so
they belong before Phase 4 rather than inside it.

### 7. Not blocking, but wanted

- **Only `en.json`.** Nine locales specified in §21; the scaffolding is there
  and `pnpm i18n:check` guards completeness once a second file exists.
- **Saved reports** UI (`saved_reports` table exists, unused).
- **Manual workflow trigger** — no "run now" button.
- **Sentry `onRouterTransitionStart`** export, offered and never added.
- **Teams / GitHub / Google integrations** — the provider list holds Slack only,
  but the dispatcher is provider-agnostic apart from one `switch`.

### Operational prerequisites, not code

- **Supabase dashboard:** Resend as the SMTP provider and both email templates
  rewritten to `{{ .Token }}`. Auth email is broken at volume until this is
  done. See `docs/AUTH.md`.
- **Slack app** at api.slack.com/apps if the integration is to be used, plus
  `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`.
- **`INNGEST_SIGNING_KEY`** in production. It is the only thing authenticating
  `/api/inngest`.

---

## Authentication

Supabase Auth issues the JWTs; Resend delivers the mail; verification is a
six-digit code, never a magic link. **Two dashboard settings are required and
are not in this repo** — Resend as the SMTP provider, and both email templates
rewritten to send `{{ .Token }}`. See `docs/AUTH.md`.

No auth call passes `emailRedirectTo` or `redirectTo`. Adding one reintroduces
the magic link, which scanners consume before the recipient sees it.

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
- `apps/web/vitest.config.ts` sets `jsx: 'automatic'`. Without it, TSX under
  test fails with "React is not defined" — the PDF templates are the only TSX
  currently exercised by a unit test.
- The PDF route is the sole importer of `@react-pdf/renderer`; keep it that way
  so the dependency never reaches a page bundle. Money is formatted by the
  caller and passed in pre-formatted, so the PDF cannot disagree with the UI.
