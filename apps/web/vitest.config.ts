import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the web app.
 *
 * `jsx: 'automatic'` matters: the PDF templates are TSX rendered on the server,
 * and without it esbuild leaves bare `React.createElement` calls that fail with
 * "React is not defined". Next applies the automatic runtime in its own build,
 * so this only has to match it for tests.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
