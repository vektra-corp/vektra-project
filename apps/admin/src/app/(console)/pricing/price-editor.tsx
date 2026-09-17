'use client'

import { Badge, Button, Input } from '@pm/ui'
import { useState, useTransition } from 'react'
import { setPlanPriceActive, updatePlanPrice } from './actions'

/**
 * One editable price row.
 *
 * The amount entered IS the amount charged. GST is contained within it and is
 * shown broken out underneath, rather than added on top — previously an
 * operator who typed 499 produced a ₹588.82 debit, which is not what anybody
 * means by setting a price to 499.
 */
export function PriceEditor({
  priceId,
  currency,
  unitAmountMinor,
  taxWithinMinor,
  isActive,
  activeSubscriptions,
  readOnly,
  /** Set on an annual row: what twelve months at the monthly price would cost. */
  annualBaselineMinor,
}: {
  priceId: string
  currency: string
  unitAmountMinor: number
  taxWithinMinor: number
  isActive: boolean
  activeSubscriptions: number
  readOnly: boolean
  annualBaselineMinor?: number
}) {
  const [amount, setAmount] = useState((unitAmountMinor / 100).toFixed(2))
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  const entered = Math.round(Number(amount) * 100)
  const dirty = Number.isFinite(entered) && entered !== unitAmountMinor

  // Recomputed from what is typed, so the saving stays live while editing.
  const discountPct =
    annualBaselineMinor && annualBaselineMinor > 0 && Number.isFinite(entered)
      ? Math.round(((annualBaselineMinor - entered) / annualBaselineMinor) * 1000) / 10
      : null

  function save() {
    const form = new FormData()
    form.set('price_id', priceId)
    form.set('unit_amount_major', amount)
    startTransition(async () => {
      const result = await updatePlanPrice(form)
      setFailed(!result.ok)
      setMessage(result.message ?? null)
    })
  }

  function toggleActive() {
    const form = new FormData()
    form.set('price_id', priceId)
    form.set('is_active', String(!isActive))
    startTransition(async () => {
      const result = await setPlanPriceActive(form)
      setFailed(!result.ok)
      setMessage(result.message ?? null)
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-3 py-3">
      <div className="w-28">
        <label htmlFor={`amount-${priceId}`} className="label-meta text-faint block pb-1">
          {currency} / seat
        </label>
        <Input
          id={`amount-${priceId}`}
          value={amount}
          inputMode="decimal"
          disabled={readOnly || pending}
          onChange={(event) => setAmount(event.target.value)}
          className="tabular-nums"
        />
      </div>

      <div className="min-w-36 pb-2 text-sm">
        <p className="text-muted-foreground tabular-nums">
          {currency === 'INR' ? (
            <>includes GST {(taxWithinMinor / 100).toFixed(2)}</>
          ) : (
            <>no GST — export</>
          )}
        </p>
        <p className="text-faint text-xs">
          {activeSubscriptions === 0
            ? 'no subscribers'
            : `${activeSubscriptions} subscriber${activeSubscriptions === 1 ? '' : 's'}`}
        </p>
      </div>

      {annualBaselineMinor ? (
        <div className="min-w-40 pb-2 text-sm">
          {discountPct === null ? null : discountPct > 0 ? (
            <p className="text-success tabular-nums">{discountPct}% off monthly</p>
          ) : discountPct < 0 ? (
            <p className="text-destructive tabular-nums">
              {Math.abs(discountPct)}% MORE than monthly
            </p>
          ) : (
            <p className="text-muted-foreground">same as 12 × monthly</p>
          )}
          <p className="text-faint text-xs tabular-nums">
            12 × monthly = {(annualBaselineMinor / 100).toFixed(2)}
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pb-1">
        <Button size="sm" disabled={readOnly || pending || !dirty} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="outline" disabled={readOnly || pending} onClick={toggleActive}>
          {isActive ? 'Withdraw' : 'Make available'}
        </Button>
        {isActive ? null : <Badge variant="outline">Withdrawn</Badge>}
      </div>

      {message ? (
        <p
          className={`w-full pb-1 text-xs ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
