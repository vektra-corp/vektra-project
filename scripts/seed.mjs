#!/usr/bin/env node
/**
 * Load supabase/seed.sql into the database named by SUPABASE_DB_URL.
 *
 * A node equivalent of `psql -f supabase/seed.sql`, so seeding works without
 * libpq installed. Runs in one transaction: a seed that fails halfway would
 * leave a fixture the RLS tests then assert against and misreport.
 *
 * The seed is idempotent (every insert is ON CONFLICT DO NOTHING), so re-running
 * it after adding fixtures only adds the new rows.
 *
 * Variables are read from apps/web/.env.local automatically; anything already
 * in the environment wins, so CI and one-off overrides still work.
 *   node scripts/seed.mjs
 */
import './load-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('SUPABASE_DB_URL is not set.')
  console.error('Expected them in apps/web/.env.local, which these scripts read automatically.')
  process.exit(1)
}

// The seed creates two fake tenants and five accounts with known passwords.
// That is development fixture data and must never reach a real deployment.
const looksProduction = /prod|production/i.test(url)
if (looksProduction && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  console.error('Refusing to seed a URL that looks like production.')
  process.exit(1)
}

const sql = readFileSync('supabase/seed.sql', 'utf8')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

await client.connect()

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')

  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM organizations)  AS orgs,
       (SELECT count(*) FROM projects)       AS projects,
       (SELECT count(*) FROM tasks)          AS tasks,
       (SELECT count(*) FROM documents)      AS documents,
       (SELECT count(*) FROM employees)      AS employees,
       (SELECT count(*) FROM leave_requests) AS leave_requests`,
  )
  console.log('Seeded. Fixture counts:', rows[0])
} catch (error) {
  await client.query('ROLLBACK')
  console.error('Seed failed, rolled back:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
