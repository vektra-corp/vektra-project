import { cn } from '@pm/ui'

/**
 * The design's navigation icons.
 *
 * Every icon in the Vektra sidebar is a geometric unicode glyph rather than a
 * drawn icon — ◍ for the dashboard, ⋔ for workflows, ▦ for a board. They are
 * set in the same 14px box the design gives them so a row's label always starts
 * on the same x, whatever the glyph's own advance width happens to be.
 *
 * `font-glyph` (see styles.css) puts the symbol-bearing system faces ahead of
 * Inter in the stack, because Inter carries the Geometric Shapes block but not
 * all of Miscellaneous Symbols and Arrows (⬒ ⬓ ⬔ ⬕), and a missing glyph is a
 * tofu box rather than a fallback.
 */
export const NAV_GLYPHS = {
  dashboard: '◍',
  inbox: '◈',
  myTasks: '◉',
  projects: '◰',
  workflows: '⋔',
  // Commercial documents: each is the same square filled a quarter turn further
  // round, so the set reads as one family.
  quotation: '⬔',
  bill: '⬕',
  salesOrder: '⬓',
  purchaseOrder: '⬒',
  contacts: '◍',
  // People and insights.
  team: '◎',
  members: '◈',
  leave: '◱',
  timesheet: '◴',
  reports: '◳',
  revenue: '◩',
  settings: '⚙',
  // Project views.
  list: '▤',
  board: '▦',
  timeline: '▥',
  workload: '◴',
  documents: '▭',
} as const

export type NavGlyph = keyof typeof NAV_GLYPHS

/** A 14px centred glyph cell — the design's nav icon gutter. */
export function NavGlyphIcon({
  glyph,
  className,
  size = 'md',
}: {
  glyph: NavGlyph
  className?: string
  /** `md` is a top-level nav row (14px box, 11px glyph); `sm` a nested view. */
  size?: 'md' | 'sm'
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'font-glyph shrink-0 text-center leading-none',
        size === 'md' ? 'w-3.5 text-[11px]' : 'w-3 text-[10px]',
        className,
      )}
    >
      {NAV_GLYPHS[glyph]}
    </span>
  )
}
