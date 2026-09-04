import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the server/client boundary in the sidebar.
 *
 * `Sidebar` is a server component and builds the nav rows; `SidebarItem` is a
 * client one and renders them. Anything crossing that boundary must be
 * serializable. A Lucide icon is a function, so passing the component itself
 * throws "Functions cannot be passed directly to Client Components" — at
 * request time, on every page in the org shell. Neither `tsc` nor ESLint sees
 * it, and no rendering test we have reaches the authenticated layout, so this
 * reads the source instead.
 *
 * The rule: icons cross as names, and `sidebar-nav.tsx` maps name -> component
 * on the client side.
 */
const dir = join(__dirname, '..')
const read = (file: string) => readFileSync(join(dir, file), 'utf8')

describe('sidebar server/client boundary', () => {
  const sidebar = read('sidebar.tsx')

  it('passes icons as names, never as components', () => {
    // `icon: Gauge` is the bug; `icon: 'Gauge'` is correct.
    const bare = [...sidebar.matchAll(/icon:\s*([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1])
    expect(bare).toEqual([])
  })

  it('uses only names the client registry can resolve', () => {
    const nav = read('sidebar-nav.tsx')
    const registry = nav.slice(nav.indexOf('const ICONS'), nav.indexOf('} as const'))
    const known = new Set([...registry.matchAll(/^\s{2}([A-Z][A-Za-z0-9]*),/gm)].map((m) => m[1]))

    const used = [...sidebar.matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    expect(known.size).toBeGreaterThan(0)

    const missing = [...new Set(used)].filter((name) => !known.has(name))
    expect(missing).toEqual([])
  })

  it('keeps the sidebar itself off the client', () => {
    // If it ever becomes a client component the boundary moves and this whole
    // guard stops meaning anything, so fail loudly rather than pass silently.
    expect(sidebar.slice(0, 200)).not.toContain('use client')
  })
})
