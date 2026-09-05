import { cn } from '@pm/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Which part of the product a widget reports on.
 *
 * The design tags every widget with its source module in the meta face, so a
 * mixed dashboard stays legible: you can tell at a glance which panels are
 * delivery, which are money, and which are people, without reading the titles.
 */
export type WidgetCategory = 'pm' | 'revenue' | 'timesheet' | 'hr' | 'admin'

const CATEGORY_TONE: Record<WidgetCategory, string> = {
  pm: 'text-primary',
  revenue: 'text-status-review',
  timesheet: 'text-status-done',
  hr: 'text-warning',
  admin: 'text-faint',
}

/** Titled panel wrapper shared by every dashboard widget. */
export function Widget({
  title,
  category,
  action,
  children,
  className,
}: {
  title: string
  category?: WidgetCategory
  action?: { label: string; href: string }
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'border-border bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border',
        className,
      )}
    >
      {/*
       * No rule under the header: the design separates a widget's title from
       * its body with space rather than a line, which keeps a grid of six
       * panels from turning into a grid of boxes-within-boxes.
       */}
      <header className="flex items-center gap-2 px-4 pb-2 pt-3.5">
        <h2 className="text-faint truncate font-mono text-[11px]">{title}</h2>
        {category ? (
          <span className={cn('label-meta', CATEGORY_TONE[category])}>{category}</span>
        ) : null}
        {action ? (
          <Link
            href={action.href}
            className="text-faint hover:text-foreground ms-auto shrink-0 text-ui transition-colors"
          >
            {action.label}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  )
}

export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="text-faint px-4 py-8 text-center text-ui">{children}</p>
}
