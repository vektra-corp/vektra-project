import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the server/client boundary in the sidebar.
 *
 * `Sidebar` is a server component and builds the nav rows; `SidebarItem` is a
 * client one and renders them. Anything crossing that boundary must be
 * serializable. Passing a component — a Lucide icon, say — throws "Functions
 * cannot be passed directly to Client Components" at request time, on every
 * page in the org shell. Neither `tsc` nor ESLint sees it, and no rendering
 * test we have reaches the authenticated layout, so this reads the source.
 *
 * The rule: icons cross as names, and `nav-glyph.tsx` maps name -> glyph on the
 * client side.
 */
const dir = join(__dirname, '..')
const read = (file: string) => readFileSync(join(dir, file), 'utf8')

describe('sidebar server/client boundary', () => {
  const sidebar = read('sidebar.tsx')

  it('passes icons as names, never as components', () => {
    // `icon: Gauge` is the bug; `icon: 'workload'` is correct.
    const bare = [...sidebar.matchAll(/icon:\s*([A-Za-z][A-Za-z0-9]*)[,\s}]/g)].map((m) => m[1])
    expect(bare).toEqual([])
  })

  it('uses only names the client registry can resolve', () => {
    const glyphs = read('nav-glyph.tsx')
    const registry = glyphs.slice(glyphs.indexOf('const NAV_GLYPHS'), glyphs.indexOf('} as const'))
    const known = new Set([...registry.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]))

    const used = [...sidebar.matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1])
    expect(used.length).toBeGreaterThan(0)
    expect(known.size).toBeGreaterThan(0)

    const missing = [...new Set(used)].filter((name) => !known.has(name))
    expect(missing).toEqual([])
  })

  it('keeps every registered glyph a plain string', () => {
    // A glyph that stopped being a literal would be a value the boundary
    // cannot carry, which is the whole failure mode this file exists for.
    const glyphs = read('nav-glyph.tsx')
    const registry = glyphs.slice(glyphs.indexOf('const NAV_GLYPHS'), glyphs.indexOf('} as const'))
    const entries = [...registry.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*(.+?),\s*$/gm)]
    expect(entries.length).toBeGreaterThan(0)
    for (const [, name, value] of entries) {
      expect(value, `${name} must be a string literal`).toMatch(/^'.*'$/)
    }
  })

  it('keeps the sidebar itself off the client', () => {
    // If it ever becomes a client component the boundary moves and this whole
    // guard stops meaning anything, so fail loudly rather than pass silently.
    expect(sidebar.slice(0, 200)).not.toContain('use client')
  })
})
