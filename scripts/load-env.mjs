import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load `apps/web/.env.local` into this process.
 *
 * Every `db:*` script needs the same three or four variables, and the previous
 * arrangement was to tell people to run:
 *
 *   set -a; source apps/web/.env.local; set +a
 *
 * That works, but it is a step to forget before every command, the error when
 * you do forget names the variables rather than the fix, and `set -a` exports
 * everything in the file into the shell for the rest of the session — which has
 * bitten in this repo, where it left a shell unable to find `curl`.
 *
 * Reading the file here removes the step entirely.
 *
 * **A variable already in the environment always wins.** CI sets real values
 * and must not have them overwritten by a developer's local file, and
 * `SUPABASE_DB_URL=... pnpm db:seed` has to keep pointing where it was told.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Files are read in order; the first definition of a variable wins. */
const CANDIDATES = ['apps/web/.env.local', '.env.local', '.env']

export function loadEnv() {
  for (const relative of CANDIDATES) {
    let contents
    try {
      contents = readFileSync(path.join(ROOT, relative), 'utf8')
    } catch {
      continue
    }

    for (const line of contents.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const separator = trimmed.indexOf('=')
      if (separator === -1) continue

      const key = trimmed.slice(0, separator).trim()
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
      if (process.env[key] !== undefined) continue

      // Strip one layer of matching quotes; a value containing '=' keeps it,
      // which matters because connection strings and JWTs are full of them.
      const raw = trimmed.slice(separator + 1).trim()
      process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2')
    }
  }
}

loadEnv()
