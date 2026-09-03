import { defineConfig } from 'vitest/config'

/**
 * RLS isolation suite. Runs against a live Postgres (local Supabase in dev, the
 * CLI-provisioned database in CI) rather than a mock — policies can only be
 * tested by the engine that enforces them.
 */
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    environment: 'node',
    // Tests share one database; running files in parallel would let one
    // suite's fixtures race another's assertions.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
