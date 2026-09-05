#!/usr/bin/env node
/**
 * Apply one migration file to the database named by SUPABASE_DB_URL.
 *
 * This project's schema was applied directly rather than through
 * `supabase db push`, so the CLI's history table (supabase_migrations.
 * schema_migrations) does not exist. Running `db push` against it would make the
 * CLI believe nothing has ever been applied and try to replay 00001 onward
 * against a database that already has 52 tables.
 *
 * This applies a single file the same way the earlier ones were applied, inside
 * one transaction so a partial migration is never left behind.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/00014_member_invites.sql
 *
 * Variables are read from apps/web/.env.local automatically; anything already
 * in the environment wins, so CI and one-off overrides still work.
 */
import './load-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path-to-sql-file>')
  process.exit(1)
}

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set.')
  console.error('Expected them in apps/web/.env.local, which these scripts read automatically.')
  process.exit(1)
}

const sql = readFileSync(file, 'utf8')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

await client.connect()

// The leading number in the filename, which is what the CLI's history table
// keys on: `00025_session_management.sql` -> `00025`.
const version = file.split('/').pop()?.match(/^(\d+)/)?.[1] ?? null

try {
  await client.query('BEGIN')
  await client.query(sql)

  /*
   * Record it the way `supabase db push` would.
   *
   * Without this the CLI's history table drifts: it said 24 applied while 32
   * files were on disk, because everything from 00025 onward went in through
   * this script. That matters beyond tidiness — deploy.yml runs `supabase db
   * push`, which trusts the table to decide what is outstanding, so a stale
   * history means a deploy either replays applied migrations or skips real
   * ones.
   *
   * Inside the same transaction as the migration, so a rollback un-records it
   * too and the two can never disagree.
   */
  if (version) {
    await client.query('CREATE SCHEMA IF NOT EXISTS supabase_migrations')
    await client.query(
      `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
         version text PRIMARY KEY,
         statements text[],
         name text
       )`,
    )
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name)
       VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
      [version, file.split('/').pop()],
    )
  }

  await client.query('COMMIT')
  console.log(`Applied ${file}${version ? ` (recorded as ${version})` : ''}`)
} catch (error) {
  await client.query('ROLLBACK')
  console.error(`Failed, rolled back: ${file}`)
  console.error(error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
