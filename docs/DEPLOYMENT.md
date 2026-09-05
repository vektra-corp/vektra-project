# Deployment

One repository, two Vercel projects, two subdomains of `vektracorp.in`.

| App | Vercel root directory | URL |
|---|---|---|
| `apps/web` | `apps/web` | `https://project.vektracorp.in` |
| `apps/admin` | `apps/admin` | `https://admin.vektracorp.in/project` |

The admin console is mounted at a **path** because `admin.vektracorp.in` is
intended to host the console for every Vektra product. See
`apps/admin/VERCEL.md` for what to do when the second product arrives — the
short version is that a Vercel domain belongs to one project, so a shell project
will eventually take the subdomain and rewrite into each product's console.

---

## What is automated

`.github/workflows/deploy.yml`:

- **`develop` → staging.** Runs CI, then deploys whichever apps changed.
- **`main` → production.** Runs CI, applies migrations, deploys, then smoke-tests
  both URLs.
- Migrations run **before** the new code, which is why §15 requires every
  migration to be backward-compatible: for the length of a deploy the old code
  is talking to the new schema.
- Only the apps that changed are deployed. A change under `packages/` counts as
  a change to both, because either may depend on it.

## What is not, and cannot be from here

Everything below is console work. **Nothing deploys until it is done**, and two
of these fail silently rather than loudly.

### 1. GitHub — environments and secrets

Create two environments under Settings → Environments:

- **`staging`** — no protection needed.
- **`production`** — add yourself as a **required reviewer**. Without this the
  gate in `deploy.yml` is decorative and `main` ships straight to production.

Repository secrets:

| Secret | Where it comes from |
|---|---|
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` after `vercel link`, or the dashboard |
| `VERCEL_PROJECT_ID_WEB` | same, for the web project |
| `VERCEL_PROJECT_ID_ADMIN` | same, for the admin project |
| `PRODUCTION_DB_URL` | Supabase → Settings → Database → connection string, **port 5432** |

> `PRODUCTION_DB_URL` must be the direct connection (5432), not the pooler
> (6543). Migrations need prepared statements and fail on the transaction
> pooler with SQLSTATE 42P05. This is trap 1 in `PROJECT-STATUS.md`.

### 2. Vercel — two projects

For each: import the same repo, set **Root Directory**, enable **Include files
outside root directory** (the build needs `packages/*` and the lockfile), Node
20. `vercel.json` in each app covers the build and install commands.

Set the environment variables from `.env.example` on both, for Production and
Preview. Note especially:

- `NEXT_PUBLIC_APP_URL=https://project.vektracorp.in`
- `NEXT_PUBLIC_ADMIN_URL=https://admin.vektracorp.in/project`
- `INNGEST_SIGNING_KEY` — **currently empty.** It is the only thing
  authenticating `/api/inngest`, which is excluded from auth middleware because
  Inngest calls it machine-to-machine. Do not deploy the background jobs without
  it.
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only. It bypasses RLS entirely.

### 3. DNS

Two CNAMEs at the registrar, both to `cname.vercel-dns.com`:

```
project.vektracorp.in   CNAME   cname.vercel-dns.com
admin.vektracorp.in     CNAME   cname.vercel-dns.com
```

Vercel issues and renews the certificates.

### 4. Supabase

- **Auth → URL Configuration:** Site URL `https://project.vektracorp.in`, and add
  `https://project.vektracorp.in/auth/callback` to the redirect allow-list.
  Invites and portal links break without it.
- **Auth → SMTP:** Resend, `smtp.resend.com:465`, user `resend`, password is the
  `RESEND_API_KEY`. **Still outstanding.** Supabase's built-in mailer is rate
  limited to a handful an hour — auth email breaks at volume until this is done.
- **Auth → Email Templates:** rewrite both to send `{{ .Token }}`, not a magic
  link. See `docs/AUTH.md` for why: scanners follow links and consume the
  single-use token before the recipient sees it.

### 5. Stripe

- Webhook endpoint → `https://project.vektracorp.in/api/webhooks/stripe`
- Put the **new** signing secret in `STRIPE_WEBHOOK_SECRET`. It differs per
  endpoint; the test-mode one will not verify.

### 6. Inngest

- App URL → `https://project.vektracorp.in/api/inngest`
- Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
- Confirm the route reports `{"function_count":9}`.

---

## Before the first production deploy

- [ ] Take a manual Supabase backup and **restore it somewhere** to prove the
      path works. PITR being enabled is not the same as knowing a restore does.
- [ ] Check the Vercel region matches the database. `vercel.json` says `bom1`
      (Mumbai); the database is `ap-southeast-2` (Sydney). Every page makes
      several sequential queries, so the round trip dominates — locally that is
      ~370 ms per query and 3-5 s per page. Moving the database to the region
      nearest your users is the single largest performance change available.
- [ ] `ADMIN_ALLOWED_EMAILS` is set on the admin project, or nobody can sign in.
- [ ] Run the RLS suite against a copy of production, never production itself:
      it inserts and deletes rows and refuses to run without
      `ALLOW_DESTRUCTIVE_TESTS=true` for that reason.

## Why the workflows look pinned to hashes

Third-party actions and CLIs are pinned to a full commit SHA or an exact
version, not a tag. A tag is mutable: whoever owns an action can re-point `@v1`,
and it runs in a job that holds `VERCEL_TOKEN` and `PRODUCTION_DB_URL`. The same
applies to `npm install --global vercel@latest`, which is why that has a version
too.

`actions/*` are left on major tags — they are GitHub's own, which is the usual
trust boundary.

Dependabot (`.github/dependabot.yml`) raises the bumps weekly so the pins do not
quietly rot. Review each one; do not merge them blind, because that gives back
exactly what pinning bought.

## Moving the database to another Supabase project

Done once already, from `ap-southeast-2` (Sydney) to `ap-south-1`, because the
round trip dominated every page. The steps, for the next time:

1. Create the new project. Note its connection string (**port 5432**, not the
   pooler), project URL, anon key and service-role key.

2. Apply the schema with the CLI, not with `scripts/apply-migration.mjs`:

   ```bash
   npx supabase db push --db-url "$NEW_SUPABASE_DB_URL"
   ```

   `db push` writes `supabase_migrations.schema_migrations` as it goes, which is
   what `deploy.yml` later reads to decide what is outstanding.

3. Seed, if the target is a development project:

   ```bash
   SUPABASE_DB_URL="$NEW_SUPABASE_DB_URL" pnpm db:seed
   ```

4. Verify before switching anything over:

   ```bash
   SUPABASE_DB_URL="$NEW_SUPABASE_DB_URL" pnpm db:check
   SUPABASE_DB_URL="$NEW_SUPABASE_DB_URL" ALLOW_DESTRUCTIVE_TESTS=true pnpm test:rls
   ```

5. Only then point `apps/web/.env.local` and the Vercel environment variables at
   the new project, and redo the Supabase console steps in section 4 above — auth
   redirect URLs, SMTP and email templates are per project and do not come across.

Storage objects are NOT moved by any of this. There were none at the time; if
there are, copy them separately before switching.

## Rolling back

Vercel keeps every deployment; promoting a previous one is instant and is the
first thing to reach for.

**A migration does not roll back with it.** That is the whole reason for the
backward-compatibility rule: the previous release must be able to run against
the newer schema. To undo a schema change, write a new migration forward —
never edit or revert an applied one (trap 7).
