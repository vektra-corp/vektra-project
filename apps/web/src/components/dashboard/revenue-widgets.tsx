import { formatCurrency } from '@pm/shared/utils'
import { cn } from '@pm/ui'
import type { LucideIcon } from 'lucide-react'
import { Widget, WidgetEmpty } from './widget'

export interface RevenueMonth {
  month: string
  currency: string
  pipelineQuotations: number
  acceptedQuotations: number
  rejectedQuotations: number
}

/**
 * Pipeline figures (§19.9).
 *
 * Invoiced, outstanding and overdue were invoice-derived and left with the
 * invoice (migration 00035). What remains is the quotation pipeline: value
 * offered, value won, value lost.
 *
 * Every figure is a single magnitude, so these are stat tiles and a bar list
 * rather than charts — a plot of one number adds ink without adding
 * information. Money is formatted in the document's own currency, never
 * summed across currencies: 100 USD + 100 EUR is not 200 of anything.
 */
export function RevenueTile({
  label,
  value,
  currency,
  locale,
  icon: Icon,
  tone = 'default',
  caption,
}: {
  label: string
  value: number
  currency: string
  locale: string
  icon: LucideIcon
  tone?: 'default' | 'warning' | 'critical' | 'positive'
  caption?: string
}) {
  const tones = {
    default: { icon: 'text-faint', value: 'text-foreground' },
    positive: { icon: 'text-success', value: 'text-foreground' },
    warning: { icon: 'text-warning', value: 'text-warning' },
    critical: { icon: 'text-destructive', value: 'text-destructive' },
  } as const

  // A zero is never alarming, whatever tone the tile is configured with.
  const style = value === 0 ? tones.default : tones[tone]

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', style.icon)} aria-hidden />
        <span className="label-meta text-faint">{label}</span>
      </div>
      <p className={cn('pt-3 text-head font-semibold tabular-nums', style.value)}>
        {formatCurrency(value, currency, locale)}
      </p>
      {caption ? <p className="pt-1 text-nav text-muted-foreground">{caption}</p> : null}
    </div>
  )
}

/**
 * Won quotation value over time.
 *
 * A horizontal bar per month, scaled against the largest month in the window,
 * with the value direct-labelled so it never has to be read off the bar. One
 * measure, one axis — no dual scales.
 */
export function RevenueTrend({
  months,
  currency,
  locale,
}: {
  months: RevenueMonth[]
  currency: string
  locale: string
}) {
  const inCurrency = months.filter((month) => month.currency === currency)

  if (inCurrency.length === 0) {
    return (
      <Widget title="Accepted trend" category="revenue" className="h-full">
        <WidgetEmpty>No quotations issued yet.</WidgetEmpty>
      </Widget>
    )
  }

  const peak = Math.max(...inCurrency.map((month) => month.acceptedQuotations), 1)

  return (
    <Widget title={`Accepted quotations · ${currency}`} category="revenue" className="h-full">
      <ul className="space-y-2 overflow-y-auto px-4 py-3">
        {inCurrency.map((month) => {
          const pct = Math.round((month.acceptedQuotations / peak) * 100)
          const label = new Date(`${month.month}T00:00:00`).toLocaleDateString(locale, {
            month: 'short',
            year: 'numeric',
          })

          return (
            <li key={`${month.month}-${month.currency}`} className="flex items-center gap-3">
              <span className="label-meta w-20 shrink-0 text-faint">{label}</span>
              <span className="h-4 min-w-0 flex-1 overflow-hidden rounded bg-track">
                <span
                  className="block h-full rounded bg-gradient-to-r from-brand-from to-brand-to"
                  style={{ width: `${Math.max(pct, month.acceptedQuotations > 0 ? 2 : 0)}%` }}
                />
              </span>
              <span className="w-28 shrink-0 text-end text-base tabular-nums text-muted-foreground">
                {formatCurrency(month.acceptedQuotations, month.currency, locale)}
              </span>
            </li>
          )
        })}
      </ul>
    </Widget>
  )
}

/** Sum one field across every month, per currency. */
export function totalsByCurrency(
  months: RevenueMonth[],
  field: keyof Omit<RevenueMonth, 'month' | 'currency'>,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const month of months) {
    totals.set(month.currency, (totals.get(month.currency) ?? 0) + month[field])
  }
  return totals
}
