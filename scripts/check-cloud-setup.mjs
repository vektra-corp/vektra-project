#!/usr/bin/env node
/**
 * Verify a hosted Supabase project is wired up correctly.
 *
 * There is one failure mode that costs hours if you meet it cold: the
 * `[auth.hook.custom_access_token]` block in supabase/config.toml applies to
 * LOCAL development only. On a hosted project the hook must be enabled in the
 * dashboard (Authentication > Hooks). If it is not, JWTs carry no `org_id`,
 * `auth.org_id()` returns NULL, every RLS policy denies, and the app looks
 * completely broken while the database is perfectly healthy.
 *
 * This script signs in as a seeded user and inspects the real token, which is
 * the only way to know for certain.
 *
 *   node scripts/check-cloud-setup.mjs
 */
import pg from 'pg'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const DB = process.env.SUPABASE_DB_URL

let failures = 0
const ok = (m) => console.log(`  PASS  ${m}`)
const bad = (m, hint) => {
  failures += 1
  console.log(`  FAIL  ${m}`)
  if (hint) console.log(`        ${hint}`)
}

if (!URL || !ANON || !DB) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_DB_URL.')
  console.error('Tip: set -a; source apps/web/.env.local; set +a')
  process.exit(1)
}

console.log(`\nChecking ${URL}\n`)

// --- schema ------------------------------------------------------------------
console.log('Schema')
const client = new pg.Client({ connectionString: DB, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: tables } = await client.query(
  `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
)
tables[0].n >= 51
  ? ok(`${tables[0].n} tables present`)
  : bad(`only ${tables[0].n} tables`, 'Run: pnpm db:push')

const { rows: unprotected } = await client.query(`
  SELECT t.tablename FROM pg_tables t
  WHERE t.schemaname = 'public' AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = t.tablename AND c.relrowsecurity)
`)
unprotected.length === 0
  ? ok('every table has RLS enabled')
  : bad(`${unprotected.length} tables without RLS: ${unprotected.map((r) => r.tablename).join(', ')}`)

const { rows: hook } = await client.query(`
  SELECT has_function_privilege('supabase_auth_admin',
    'public.custom_access_token_hook(jsonb)', 'EXECUTE') AS granted
`)
hook[0]?.granted
  ? ok('custom_access_token_hook is executable by supabase_auth_admin')
  : bad('supabase_auth_admin cannot execute the JWT hook', 'Re-run migration 00001')

await client.end()

// --- the part config.toml cannot do for you ----------------------------------
console.log('\nAuth')
const response = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@acme.test', password: 'password123' }),
})

const payload = await response.json()

if (!payload.access_token) {
  bad(`could not sign in as owner@acme.test (${payload.msg ?? response.status})`,
      'Has the seed run? Try: pnpm db:seed')
} else {
  ok('seeded user can sign in')

  const claims = JSON.parse(
    Buffer.from(payload.access_token.split('.')[1], 'base64url').toString(),
  )

  if (claims.org_id && claims.org_role) {
    ok(`JWT carries org_id and org_role (${claims.org_role})`)
  } else {
    bad(
      'JWT has no org_id / org_role claim — RLS will deny everything',
      'Dashboard > Authentication > Hooks > Customize Access Token (JWT) Claims\n' +
        '        Enable it and select: public.custom_access_token_hook\n' +
        '        (supabase/config.toml only configures this for LOCAL development)',
    )
  }
}

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) failed — see the hints above.\n`,
)
process.exit(failures === 0 ? 0 : 1)
