import { cn } from '@pm/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'

/** Titled panel wrapper shared by every dashboard list widget. */
export function Widget({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: { label: string; href: string }
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card',
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <h2 className="label-meta text-faint">{title}</h2>
        {action ? (
          <Link
            href={action.href}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
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
  return <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">{children}</p>
}
