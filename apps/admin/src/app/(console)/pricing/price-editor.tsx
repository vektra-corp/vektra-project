'use client'

import { Badge, Button, Input } from '@pm/ui'
import { useState, useTransition } from 'react'
import { setPlanPriceActive, updatePlanPrice } from './actions'

/**
 * One editable price row.
 *
 * The amount is entered in major units because that is how an operator thinks
 * about a price; the action converts once and stores minor units. The
 * GST-inclusive figure is shown alongside for Indian currency so nobody has to
 * do 18% in their head to know what the customer will actually be debited.
 */
export function PriceEditor({
  priceId,
  currency,
  unitAmountMinor,
  grossMinor,
  isActive,
  activeSubscriptions,
  readOnly,
}: {
  priceId: string
  currency: string
  unitAmountMinor: number
  grossMinor: number
  isActive: boolean
  activeSubscriptions: number
  readOnly: boolean
}) {
  const [amount, setAmount] = useState((unitAmountMinor / 100).toFixed(2))
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  const dirty = Math.round(Number(amount) * 100) !== unitAmountMinor

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

      <div className="min-w-32 pb-2 text-sm">
        <p className="text-muted-foreground tabular-nums">
          {currency === 'INR' ? (
            <>incl. GST {(grossMinor / 100).toFixed(2)}</>
          ) : (
            <>ex-tax</>
          )}
        </p>
        <p className="text-faint text-xs">
          {activeSubscriptions === 0
            ? 'no subscribers'
            : `${activeSubscriptions} subscriber${activeSubscriptions === 1 ? '' : 's'}`}
        </p>
      </div>

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
