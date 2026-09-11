import { WIDGET_CATEGORY_LABELS, type WidgetCategory } from '@pm/shared/constants'
import { cn } from '@pm/ui'
import Link from 'next/link'
import type { ReactNode } from 'react'

export type { WidgetCategory }

const CATEGORY_TONE: Record<WidgetCategory, string> = {
  pm: 'text-primary',
  workflow: 'text-muted-foreground',
}

/**
 * Titled panel wrapper shared by every dashboard widget.
 *
 * The design's chrome: an 11px radius over the card fill, 14px/15px of padding,
 * and a header of one tracked mono label with the module tag beside it. There is
 * no rule under the header — space separates the title from the body, which
 * keeps a grid of six panels from reading as boxes inside boxes.
 */
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
        'border-border bg-card flex h-full min-w-0 flex-col gap-[9px] overflow-hidden rounded-[11px] border px-[15px] py-3.5',
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <h2 className="label-meta-lg text-subtle truncate">{title}</h2>
        {category ? (
          <span
            className={cn(
              'shrink-0 font-mono text-[8.5px] uppercase leading-none tracking-[0.1em]',
              CATEGORY_TONE[category],
            )}
          >
            {WIDGET_CATEGORY_LABELS[category]}
          </span>
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
  return <p className="text-subtle py-2.5 text-nav">{children}</p>
}

/**
 * The design's headline block: a 24px figure, a delta beside it, and a note
 * under both. Used by every single-number widget so they stay identical.
 */
export function WidgetKpi({
  value,
  delta,
  deltaTone = 'neutral',
  note,
  valueClassName,
}: {
  value: string | number
  delta?: string
  deltaTone?: 'neutral' | 'good' | 'bad'
  note?: string
  valueClassName?: string
}) {
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            'text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums',
            valueClassName,
          )}
        >
          {value}
        </span>
        {delta ? (
          <span
            className={cn(
              'text-micro',
              deltaTone === 'good'
                ? 'text-primary'
                : deltaTone === 'bad'
                  ? 'text-destructive'
                  : 'text-faint',
            )}
          >
            {delta}
          </span>
        ) : null}
      </div>
      {note ? <p className="text-faint text-micro leading-normal">{note}</p> : null}
    </div>
  )
}

/** A labelled horizontal bar — workload, progress per project, revenue by client. */
export function WidgetBar({
  label,
  value,
  percent,
  color,
  labelWidth = '82px',
}: {
  label: string
  value: string
  percent: number
  color: string
  labelWidth?: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-muted-foreground truncate text-nav" style={{ width: labelWidth }}>
        {label}
      </span>
      <span className="bg-chip block h-1.5 flex-1 overflow-hidden rounded">
        <span
          className="block h-full rounded"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
        />
      </span>
      <span className="text-faint whitespace-nowrap font-mono text-col tabular-nums">{value}</span>
    </div>
  )
}

/** One row of a widget's list body. */
export function WidgetRow({
  left,
  main,
  right,
  rightTone,
  href,
}: {
  left?: string
  main: string
  right?: string
  rightTone?: string
  href?: string
}) {
  const body = (
    <>
      {left ? (
        <span className="text-subtle whitespace-nowrap font-mono text-id tabular-nums">{left}</span>
      ) : null}
      <span className="truncate text-ui">{main}</span>
      {right ? (
        <span
          className={cn(
            'ms-auto whitespace-nowrap font-mono text-id tabular-nums',
            rightTone ?? 'text-subtle',
          )}
        >
          {right}
        </span>
      ) : null}
    </>
  )

  const className =
    'border-border flex items-center gap-2.5 border-b py-2 last:border-b-0 transition-colors'

  return href ? (
    <Link href={href} className={cn(className, 'hover:text-primary')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
