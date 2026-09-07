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

/**
 * The scrolling panel beside the settings rail.
 *
 * The design's own metrics: 24px above, 30px each side, 34px below, a 22px
 * rhythm between blocks, and a 760px cap so a form field never stretches to the
 * width of a desktop window. Settings pages use this instead of `PageBody` so
 * the whole section shares one measure.
 */
export function SettingsPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div className={cn('flex max-w-[760px] flex-col gap-[22px] px-[30px] pb-[34px] pt-6', className)}>
        {children}
      </div>
    </div>
  )
}

/**
 * A screen's own header bar.
 *
 * The design gives every non-project screen one of these under the topbar: the
 * title at 15px semibold, a monospace count beside it, and the screen's actions
 * pushed to the end — all inside a full-bleed strip closed by a hairline. It is
 * distinct from the topbar, which says where you ARE; this says what you are
 * looking at and what you can do to it.
 */
export function SectionHeader({
  title,
  count,
  children,
}: {
  title: string
  /** The mono caption beside the title, e.g. "12 PEOPLE". */
  count?: string
  /** Controls for this screen. They sit at the end of the bar. */
  children?: ReactNode
}) {
  return (
    <div className="border-border flex shrink-0 flex-wrap items-center gap-3.5 border-b px-5 py-3">
      <h1 className="text-[15px] font-semibold">{title}</h1>
      {count ? (
        <span className="text-faint font-mono text-col uppercase tabular-nums">{count}</span>
      ) : null}
      {children ? <div className="ms-auto flex items-center gap-2">{children}</div> : null}
    </div>
  )
}

/** Title block for pages that scroll their own heading with the content. */
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
