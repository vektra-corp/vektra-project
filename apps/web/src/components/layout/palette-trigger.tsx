'use client'

import { Kbd, cn } from '@pm/ui'

/**
 * The event the sidebar's "Jump to…" and the topbar's "Search" fire.
 *
 * A custom event rather than shared state or a context: both triggers are
 * rendered by server components, and the palette is mounted once at the top of
 * the shell. An event lets a leaf open it without every layer in between having
 * to carry a handler it does not otherwise care about.
 */
export const PALETTE_EVENT = 'vektra:open-palette'

export function openPalette() {
  document.dispatchEvent(new CustomEvent(PALETTE_EVENT))
}

/** The sidebar's search field. Looks like an input; opens the palette. */
export function SidebarPaletteTrigger({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      className="border-border bg-sunk text-faint hover:border-input hover:text-muted-foreground flex w-full items-center gap-2 rounded-lg border px-2.5 py-[7px] text-nav transition-colors"
    >
      <span aria-hidden className="font-glyph shrink-0">
        ⌕
      </span>
      <span className="flex-1 text-start">{label}</span>
      <Kbd>⌘K</Kbd>
    </button>
  )
}

/** The topbar's outlined search button. */
export function TopbarPaletteTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openPalette}
      className={cn(
        'border-input text-faint hover:text-foreground flex items-center gap-[7px] rounded-[7px] border px-2.5 py-[5px] text-nav transition-colors',
        className,
      )}
    >
      <span aria-hidden className="font-glyph">
        ⌕
      </span>
      Search
      <Kbd className="border-0 px-0 text-meta">⌘K</Kbd>
    </button>
  )
}
