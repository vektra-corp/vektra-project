'use client'

import { calculateDocumentTotals, calculateLineItem, formatCurrency } from '@pm/shared/utils'
import { Button, Input, cn } from '@pm/ui'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'

export interface EditableLineItem {
  key: string
  description: string
  quantity: number
  unit_price: number
  tax_rate: number
  discount: number
}

export function blankLine(): EditableLineItem {
  return {
    key: `line-${Math.random().toString(36).slice(2, 9)}`,
    description: '',
    quantity: 1,
    unit_price: 0,
    tax_rate: 0,
    discount: 0,
  }
}

/**
 * Line items with a live total.
 *
 * The preview runs `calculateLineItem` / `calculateDocumentTotals` from
 * @pm/shared — the same functions the database triggers mirror — so what is
 * shown while typing is what gets stored. The numbers are still recomputed
 * server-side on save; this is a preview, not the source of truth.
 *
 * The list is posted as JSON in a hidden input so the whole document, header
 * and lines together, is one form submission.
 */
export function LineItemEditor({
  name,
  currency,
  locale,
  initialItems,
}: {
  name: string
  currency: string
  locale: string
  initialItems?: EditableLineItem[]
}) {
  const [items, setItems] = useState<EditableLineItem[]>(
    initialItems?.length ? initialItems : [blankLine()],
  )

  const totals = useMemo(
    () => calculateDocumentTotals(items, currency),
    [items, currency],
  )

  function update(key: string, patch: Partial<EditableLineItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    )
  }

  // A numeric field must tolerate an empty string mid-typing without becoming
  // NaN, which would poison every downstream total.
  const num = (value: string) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }

  const payload = items
    .filter((item) => item.description.trim().length > 0)
    .map((item, index) => ({
      description: item.description.trim(),
      quantity: item.quantity,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate,
      discount: item.discount,
      position: index,
    }))

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="scrollbar-slim overflow-x-auto">
          <table className="w-full min-w-[720px] text-ui">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="label-meta px-3 py-2 text-start text-faint">Description</th>
                <th className="label-meta w-20 px-3 py-2 text-end text-faint">Qty</th>
                <th className="label-meta w-28 px-3 py-2 text-end text-faint">Unit price</th>
                <th className="label-meta w-24 px-3 py-2 text-end text-faint">Tax %</th>
                <th className="label-meta w-28 px-3 py-2 text-end text-faint">Discount</th>
                <th className="label-meta w-32 px-3 py-2 text-end text-faint">Line total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const line = calculateLineItem(item, currency)
                return (
                  <tr key={item.key} className="border-b border-border-subtle last:border-0">
                    <td className="px-2 py-1.5">
                      <Input
                        value={item.description}
                        onChange={(event) => update(item.key, { description: event.target.value })}
                        placeholder="What is being charged for"
                        aria-label="Description"
                        className="h-8 border-transparent bg-transparent"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.quantity}
                        onChange={(event) => update(item.key, { quantity: num(event.target.value) })}
                        aria-label="Quantity"
                        className="h-8 border-transparent bg-transparent text-end tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(event) =>
                          update(item.key, { unit_price: num(event.target.value) })
                        }
                        aria-label="Unit price"
                        className="h-8 border-transparent bg-transparent text-end tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={item.tax_rate}
                        onChange={(event) =>
                          update(item.key, { tax_rate: Math.min(100, num(event.target.value)) })
                        }
                        aria-label="Tax rate"
                        className="h-8 border-transparent bg-transparent text-end tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discount}
                        onChange={(event) => update(item.key, { discount: num(event.target.value) })}
                        aria-label="Discount"
                        className="h-8 border-transparent bg-transparent text-end tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-end">
                      <span
                        className={cn(
                          'text-base tabular-nums',
                          // The discount is capped at the gross, matching the
                          // trigger, so flag a value that will be clamped.
                          item.discount > line.gross ? 'text-warning' : 'text-muted-foreground',
                        )}
                        title={
                          item.discount > line.gross
                            ? 'Discount is larger than the line and will be capped'
                            : undefined
                        }
                      >
                        {formatCurrency(line.line_total, currency, locale)}
                      </span>
                    </td>
                    <td className="px-1 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove line"
                        disabled={items.length === 1}
                        onClick={() =>
                          setItems((current) => current.filter((row) => row.key !== item.key))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border-subtle px-2 py-2">
          <Button
            type="button"
            variant="dashed"
            size="sm"
            className="w-full justify-start gap-1.5"
            onClick={() => setItems((current) => [...current, blankLine()])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add line
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <dl className="w-64 space-y-1.5 rounded-lg border border-border bg-surface p-4 shadow-card">
          <Total label="Subtotal" value={totals.subtotal} currency={currency} locale={locale} />
          {totals.discount_total > 0 ? (
            <Total
              label="Discount"
              value={-totals.discount_total}
              currency={currency}
              locale={locale}
            />
          ) : null}
          <Total label="Tax" value={totals.tax_total} currency={currency} locale={locale} />
          <div className="border-t border-border-subtle pt-1.5">
            <Total
              label="Total"
              value={totals.grand_total}
              currency={currency}
              locale={locale}
              emphasis
            />
          </div>
        </dl>
      </div>

      <input type="hidden" name={name} value={JSON.stringify(payload)} />
    </div>
  )
}

function Total({
  label,
  value,
  currency,
  locale,
  emphasis = false,
}: {
  label: string
  value: number
  currency: string
  locale: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={cn('label-meta', emphasis ? 'text-muted-foreground' : 'text-faint')}>
        {label}
      </dt>
      <dd
        className={cn(
          'tabular-nums',
          emphasis ? 'text-ui font-semibold' : 'text-base text-muted-foreground',
        )}
      >
        {formatCurrency(value, currency, locale)}
      </dd>
    </div>
  )
}
