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
| 2 — V1 | Documents, external portal, Gantt, employees & leave, configurable dashboard, subtask Kanban, import/export | **Complete** |
| 3 — V2 | Commercial, timesheets, revenue, auto-assignment, custom fields, workflows, PDF, Slack | **Complete** |
| 4 — Hardening | Security review, load test, E2E, DR, go-live | **In progress** — RLS and E2E done, plan below |

### Phase 2 detail

Audited against §20 and completed afterwards. Two items had never been built,
and this file wrongly claimed the phase was finished — worth keeping visible,
because neither is a foundation and Phase 3 sat on top of them without noticing:

| Item | State |
|---|---|
| Subtask Kanban | **Done.** Board provisioned on demand by `ensure_task_board` (00028); existing checklist subtasks are adopted into the column their status implies. |
| Import / export | **Done.** CSV both ways, `import_export_jobs` finally written to (00029), assignee resolution via `org_member_ids_for_emails` (00030). |
| Gantt, documents, portal, contacts, employees, leave, configurable dashboard, email | Were already done |

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
# The db:* scripts read apps/web/.env.local themselves. The RLS suite does not,
# because it must be explicit about which database it is allowed to mutate.
set -a; source apps/web/.env.local; set +a
ALLOW_DESTRUCTIVE_TESTS=true pnpm test:rls
```

Current counts: **444 unit tests, 99 RLS tests, 43 end-to-end tests, 63 tables,
32 migrations, 9 background jobs.**

```bash
pnpm test:e2e        # Playwright, starts its own dev server on 3100
```

All three suites are green as of migration 00031.

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

1. **Transaction pooler breaks migrations, and the direct host may be
   unreachable.** `SUPABASE_DB_URL` points at Supavisor port 6543 (transaction
   mode), which is correct for the app but has no prepared statements —
   `supabase db push` fails there with SQLSTATE 42P05.
   `scripts/session-db-url.mjs` swaps to port 5432 and every `db:*` script uses
   it. Do not "fix" this by changing `SUPABASE_DB_URL`.

   The answer is the **session pooler** (port 5432 on
   `aws-N-<region>.pooler.supabase.com`), NOT the direct `db.<ref>.supabase.co`
   host. That one is IPv6-only unless the project buys the IPv4 add-on: macOS
   `getaddrinfo` may refuse to return its AAAA record even where IPv6 works, and
   GitHub Actions runners have no IPv6 at all, so a deploy could never reach
   it.

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

13. **A strict CSP breaks `next dev`.** The dev build compiles with `eval`, so
    a policy without `'unsafe-eval'` makes the browser refuse the client bundle:
    React never hydrates and nothing interactive works, while the page still
    renders and the server logs stay clean. `next.config.mjs` adds it in
    development only.

14. **DOMPurify drags jsdom into every server action that imports it**, and
    jsdom reads a stylesheet off disk at load. Webpack bundles the read but not
    the file, so the action 500s with ENOENT. `sanitize.ts` is dependency-free
    for that reason; `sanitize-html.ts` is the only module that may import
    DOMPurify. Do not merge them back.

15. **`useState(prop)` captures only the first value.** Both Kanban boards did
    this, so `router.refresh()` fetched new data the component then ignored and
    a newly added task stayed invisible until a full reload. When a client
    component holds optimistic state seeded from the server, re-seed it when the
    prop changes.

16. **Every top-level route must be in `NON_TENANT_SEGMENTS`.** Anything not
    listed is read as an organisation slug, and a signed-in user visiting it is
    checked for membership of an org that does not exist and sent to /403. This
    has bitten three times — `/portal`, then `/mfa` (which made the
    second-factor page unreachable), and latently `/verify` and
    `/reset-password`. The list is now derived from PUBLIC_ROUTE_PREFIXES;
    add authenticated non-tenant routes to it by hand.

17. **The Playwright process does not read `.env.local`.** The dev server does,
    the test runner does not. `playwright.config.ts` loads it; CI supplies the
    values from the job instead.

18. **E2E specs must clean up after themselves.** They create tasks on the
    seeded board, and without the teardown project the board grows every run
    until specs that pass alone start timing out together — which reads as
    flake and is not.

19. **`server-only` makes a module unimportable from vitest.** Hit four times
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

### 1. RLS suite — DONE

70 -> 99 tests, covering 00025-00030. Run it after any migration:

```bash
# The db:* scripts read apps/web/.env.local themselves. The RLS suite does not,
# because it must be explicit about which database it is allowed to mutate.
set -a; source apps/web/.env.local; set +a
ALLOW_DESTRUCTIVE_TESTS=true pnpm test:rls
```

It takes about four minutes against a hosted project. Note the harness detail
that cost time: `asUser` impersonates inside a transaction, and switching roles
in the middle of one leaves the shared connection aborted — every later test in
the file then fails for an unrelated reason. Seed anything a test needs from
another principal OUTSIDE the impersonation and clean it up in a `finally`.

### 2. E2E tests — DONE

39 Playwright tests: sign-in, every authenticated route, anonymous access, and
the task lifecycle. Wired into CI against a local Supabase.

**This is the argument for having them, made concrete.** The first run found
three bugs, none of which typecheck, ESLint or 404 unit tests could see, and two
of which broke the app for every user:

1. The CSP applied in development blocked `eval`, which Next's dev build needs,
   so React never hydrated and nothing interactive worked locally.
2. Every server action touching rich text returned 500, because DOMPurify pulled
   jsdom into the bundle and jsdom reads a stylesheet off disk. Task, subtask,
   comment and document creation were all broken.
3. A task added from the board stayed invisible until a reload — both boards
   seeded `useState(initialCards)` and ignored the refreshed server data.

Two things to know when adding specs: a server-rendered button is clickable
before React attaches its handler, so use `clickUntil` rather than a sleep; and
a Kanban card renders its title twice (visible link plus a screen-reader label),
so assert on roles rather than text.

### 3. Outstanding §13 items — IN PROGRESS

| Item | State |
|---|---|
| Magic-byte MIME sniffing | **Done.** `utils/magic-bytes`, applied in `recordAttachment` after the upload lands and before any row references it. Fails closed. Stores the sniffed type, not the claimed one. |
| Scriptable markup (SVG/HTML/XML) | **Done** — was not on the list and should have been. `image/svg+xml` passes every mechanical image test but can carry `<script>`, and attachments are served from the storage origin. |
| Session management UI | **Done.** `/{org}/settings/security`. Revocation deletes the GoTrue session, so it is real rather than cosmetic. |
| EXIF stripping / image re-encode | Not done. Needs `sharp` and a re-encode step after upload — download, strip, re-upload — because uploads go straight to storage. |
| Virus scanning | Not done. Needs ClamAV or a scanning API; cannot be completed without that infrastructure. The `recordAttachment` hook is the place it goes. |
| MFA (TOTP) | **Done.** Enrolment at `/{org}/settings/security`, challenge at `/mfa`, enforced in middleware. Org-wide enforcement (§13.5, Enterprise tier) is NOT built — it is currently opt-in per person. |
| DNS-rebinding-proof outbound calls | Not done — needs a pinned-IP agent. |
| Integration key rotation path | Not done — rotating `INTEGRATION_ENCRYPTION_KEY` orphans every stored token. |

**MFA is per person, not per organisation.** §13.5 describes org-wide
enforcement on the Enterprise tier; that is not built. Anyone may turn it on for
themselves, nobody can require it of others.

**Known limit of session revocation, stated because the UI states it too:**
deleting the refresh token stops renewal, but an access token already issued
stays valid until it expires (up to an hour). Changing the password is what ends
everything at once. Do not let the copy drift back to claiming "immediately".

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

### 6. Not blocking, but wanted

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
