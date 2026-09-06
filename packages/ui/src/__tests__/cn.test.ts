import { describe, expect, it } from 'vitest'
import { cn } from '../utils'

/**
 * Regression guard for a bug that nothing else could catch.
 *
 * The design's font-size steps (text-ui, text-nav, …) are not part of
 * Tailwind's stock scale, so tailwind-merge files any it does not recognise
 * under text-COLOUR. That put `text-ui` in the same group as `text-btn-ink`,
 * and because cva emits the size after the variant, the merge silently dropped
 * the colour — every solid button rendered its label in the inherited
 * foreground, which on a near-white button is invisible.
 *
 * It typechecked, linted and built clean. Only a rendered pixel or this test
 * can see it, so the size steps below must stay in step with the `fontSize`
 * block in tailwind.config.ts.
 */
const FONT_SIZES = ['meta', 'id', 'col', 'tag', 'micro', 'nav', 'ui', 'task', 'head'] as const

describe('cn', () => {
  it('keeps a text colour alongside a custom font size', () => {
    for (const size of FONT_SIZES) {
      const result = cn(`bg-btn text-btn-ink text-${size}`)
      expect(result, `text-${size} swallowed the colour`).toContain('text-btn-ink')
      expect(result).toContain(`text-${size}`)
    }
  })

  it('still lets a later font size win over an earlier one', () => {
    expect(cn('text-base', 'text-ui')).toBe('text-ui')
    expect(cn('text-ui', 'text-head')).toBe('text-head')
  })

  it('still lets a later colour win over an earlier one', () => {
    expect(cn('text-faint', 'text-foreground')).toBe('text-foreground')
  })

  it('merges ordinary utilities as before', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })
})
