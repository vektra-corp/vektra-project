#!/usr/bin/env node
/**
 * Print a database URL that supports prepared statements.
 *
 * The app connects through Supavisor in TRANSACTION mode (port 6543), which is
 * correct for serverless: §23.1 calls for it so concurrent function invocations
 * cannot exhaust connections. That mode does not support prepared statements,
 * and the Supabase CLI's migration runner uses them — so `db push` through 6543
 * fails with:
 *
 *   ERROR: prepared statement "lrupsc_1_0" already exists (SQLSTATE 42P05)
 *
 * Migrations therefore need the SESSION-mode port (5432) on the same host.
 * Rather than asking anyone to remember that, this derives it.
 *
 * Set SUPABASE_MIGRATION_DB_URL to override (e.g. a direct db.<ref>.supabase.co
 * connection); otherwise SUPABASE_DB_URL is reused with the port swapped.
 */
import './load-env.mjs'
const explicit = process.env.SUPABASE_MIGRATION_DB_URL
if (explicit) {
  process.stdout.write(explicit)
  process.exit(0)
}

const raw = process.env.SUPABASE_DB_URL
if (!raw) {
  console.error('Set SUPABASE_DB_URL (or SUPABASE_MIGRATION_DB_URL).')
  console.error('Expected them in apps/web/.env.local, which these scripts read automatically.')
  process.exit(1)
}

let url
try {
  url = new URL(raw)
} catch {
  console.error('SUPABASE_DB_URL is not a valid URL.')
  process.exit(1)
}

// 6543 is Supavisor's transaction port; 5432 on the same host is session mode.
// Any other port is left alone — it is already a direct connection.
if (url.port === '6543') url.port = '5432'

process.stdout.write(url.toString())
