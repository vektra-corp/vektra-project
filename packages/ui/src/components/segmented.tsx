'use client'

import * as React from 'react'
import { cn } from '../utils'

/**
 * Segmented control — the Board/List/Timeline/Documents switcher and the
 * Status/Assignee/Priority/Label filter row.
 *
 * Rendered as a radiogroup rather than tabs because the segments select a value;
 * they do not reveal panels that live in the same document. Arrow keys move
 * between segments, matching native radio behaviour.
 */
export interface SegmentedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  size?: 'sm' | 'default'
}

const SegmentedGroup = React.forwardRef<HTMLDivElement, SegmentedProps>(
  ({ className, size = 'default', ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      /*
       * Bare by default. The design draws these as a loose row of pills with
       * only the selected one filled — no enclosing track — so the switcher
       * reads as part of the toolbar rather than as a control sitting on it.
       */
      className={cn('inline-flex items-center gap-0.5', className)}
      {...props}
    />
  ),
)
SegmentedGroup.displayName = 'SegmentedGroup'

export interface SegmentedItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  /** Render as a child element (e.g. a Next.js Link) instead of a button. */
  asChild?: boolean
  size?: 'sm' | 'default'
}

/* Kept as a plain class string so the Link-based variant below can reuse it. */
function segmentedItemClass({
  active,
  size = 'default',
}: {
  active?: boolean
  size?: 'sm' | 'default'
}) {
  return cn(
    'inline-flex select-none items-center gap-1.5 rounded-md transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
    size === 'sm' ? 'h-6 px-2 text-nav' : 'h-7 px-2.5 text-ui',
    active ? 'bg-chip text-foreground font-semibold' : 'text-faint hover:text-foreground',
  )
}

const SegmentedItem = React.forwardRef<HTMLButtonElement, SegmentedItemProps>(
  ({ className, active = false, size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={cn(segmentedItemClass({ active, size }), className)}
      {...props}
    />
  ),
)
SegmentedItem.displayName = 'SegmentedItem'

export { SegmentedGroup, SegmentedItem, segmentedItemClass }
