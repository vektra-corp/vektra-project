import { cn } from '@pm/ui'
import type { ReactNode } from 'react'

/**
 * Scroll container for a section's content.
 *
 * The app shell is a fixed-height flex column, so exactly one element per screen
 * owns the scroll. Pages use this instead of letting the document scroll, which
 * would take the sidebar and section header with it.
 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 pb-8', className)}>
      {children}
    </div>
  )
}

/** Title block for pages that are not a project view. */
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 pt-4">
      <div className="min-w-0">
        <h1 className="text-head font-semibold">{title}</h1>
        {description ? <p className="text-faint pt-1 text-ui">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
