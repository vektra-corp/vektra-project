import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests (§14).
 *
 * These exist because of a specific, repeated failure mode: two bugs in this
 * project were invisible to `tsc`, ESLint AND the unit suite, and appeared only
 * on a real HTTP request — a function crossing the RSC boundary, and a
 * component that could not be resolved from the client manifest. Both took the
 * whole app down. A green CI run proved nothing about either.
 *
 * So the point of these tests is not coverage percentage. It is that something
 * renders a real page in a real browser before a deploy.
 *
 * They run against `next dev` rather than a production build. `next build`
 * would be closer to production, but it competes with a running dev server for
 * `.next` — a trap this project has already hit — and the failures being
 * guarded against are request-time failures that dev reproduces exactly.
 *
 * Data comes from `supabase/seed.sql`. The suite creates and cleans up its own
 * records where it needs isolation, and otherwise reads fixtures.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // A real browser against a real database is slow; the timeouts reflect that
  // rather than pretending otherwise.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  // One worker. The tests share one seeded database, and parallel workers would
  // let one spec's fixtures race another's assertions — the same reason the RLS
  // suite runs serially.
  workers: 1,
  fullyParallel: false,

  // Locally a failure is usually real and worth seeing immediately; in CI a
  // single retry absorbs genuine flake without hiding a consistent break.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: BASE_URL,
    // Kept only for failures: a trace of every passing run is gigabytes of
    // nothing anyone will read.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    // Signs in once and writes the storage state the other specs reuse, so
    // every spec does not pay for a login round trip.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    // A dedicated port so a running `pnpm dev` on 3000 is left alone.
    command: `pnpm --filter @pm/web dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
