import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)

/**
 * PostCSS pipeline.
 *
 * Two things matter here:
 *
 * 1. postcss-import MUST run before tailwindcss. globals.css is a single
 *    `@import '@pm/ui/styles.css'`; without this plugin the import is left
 *    unresolved, Tailwind never sees the @tailwind directives, and the build
 *    emits no stylesheet at all — the app renders as unstyled HTML.
 *
 * 2. postcss-import's own resolver does not understand a package.json "exports"
 *    map, so it cannot find `@pm/ui/styles.css` even though Node resolves it
 *    fine. Delegating to Node's resolver fixes that.
 *
 * @type {import('postcss-load-config').Config}
 */
export default {
  plugins: {
    'postcss-import': {
      resolve(id, basedir) {
        // Workspace packages: let Node apply the exports map.
        if (id.startsWith('@pm/')) return require.resolve(id)
        // Everything else keeps postcss-import's relative behaviour.
        return resolve(basedir, id)
      },
    },
    tailwindcss: {},
    autoprefixer: {},
  },
}
