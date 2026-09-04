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
 * Load the environment first:
 *   set -a; source apps/web/.env.local; set +a
 */
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
  console.error('Tip: set -a; source apps/web/.env.local; set +a')
  process.exit(1)
}

const sql = readFileSync(file, 'utf8')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

await client.connect()

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log(`Applied ${file}`)
} catch (error) {
  await client.query('ROLLBACK')
  console.error(`Failed, rolled back: ${file}`)
  console.error(error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
