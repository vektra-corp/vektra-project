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
      className={cn(
        'border-border-subtle bg-surface inline-flex items-center gap-0.5 rounded-lg border p-0.5',
        size === 'sm' && 'p-px',
        className,
      )}
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
    'inline-flex select-none items-center gap-1.5 rounded-md font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
    size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
    active
      ? 'bg-surface-hover text-foreground shadow-card'
      : 'text-muted-foreground hover:text-foreground',
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
