import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Shared constants for the E2E suite.
 *
 * The seeded accounts and ids come from `supabase/seed.sql`. They are repeated
 * here rather than imported from the RLS helpers because those import `pg` and
 * connect to the database directly, which an E2E test should not do — the whole
 * point is to go through the app.
 */

export const ACCOUNTS = {
  owner: { email: 'owner@acme.test', password: 'password123' },
  manager: { email: 'manager@acme.test', password: 'password123' },
  member: { email: 'member@acme.test', password: 'password123' },
} as const

export const ORG_SLUG = 'acme'
export const WORKSPACE_SLUG = 'engineering'
export const PROJECT_ID = 'a2a2a2a2-0000-0000-0000-000000000001'

export const STORAGE_STATE = path.join(process.cwd(), 'e2e/.auth/owner.json')

/** Where the project's views live, since almost every spec needs one. */
export const projectPath = (view: string) =>
  `/${ORG_SLUG}/${WORKSPACE_SLUG}/projects/${PROJECT_ID}/${view}`

/**
 * A name unique to this run.
 *
 * The suite runs against a shared seeded database rather than a fresh one, so a
 * fixed name would collide with a previous run's leftovers and make a passing
 * test depend on cleanup having worked.
 */
export const unique = (prefix: string): string =>
  `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** True when the app has the environment it needs; used to skip rather than fail noisily. */
export function hasSupabaseConfig(): boolean {
  try {
    const env = readFileSync(path.join(process.cwd(), 'apps/web/.env.local'), 'utf8')
    return env.includes('NEXT_PUBLIC_SUPABASE_URL') && env.includes('SUPABASE_SERVICE_ROLE_KEY')
  } catch {
    return false
  }
}

/**
 * Click something whose handler only exists after hydration.
 *
 * A server-rendered button is visible, enabled and clickable long before React
 * attaches its `onClick`. Playwright's actionability checks are all satisfied by
 * that first state, so a single click silently does nothing and the test fails
 * on whatever it expected to appear.
 *
 * Retrying the click until the effect is observable is the fix. A fixed sleep
 * would be a guess that is simultaneously too slow on a fast machine and too
 * short on a loaded one.
 */
export async function clickUntil(
  expectLib: typeof import('@playwright/test').expect,
  click: () => Promise<void>,
  settled: () => Promise<unknown>,
  timeout = 30_000,
): Promise<void> {
  await expectLib(async () => {
    await click()
    await settled()
  }).toPass({ timeout })
}
