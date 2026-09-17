'use client'

import { Button, Input, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPlan, createPlanPrice } from './actions'

const selectCls =
  'h-9 w-full rounded-md border border-input bg-surface-raised px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

/**
 * Catalogue creation.
 *
 * Split into two forms because they are two decisions: what the plan IS (its
 * tier, which decides the limits it grants) and what it COSTS in a given
 * currency and interval. Collapsing them into one form would imply a plan has
 * exactly one price, which is the assumption that left annual pricing
 * unreachable in the first place.
 */
export function NewPlanForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        New plan
      </Button>
    )
  }

  return (
    <form
      className="w-full space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card"
      action={(formData) =>
        startTransition(async () => {
          const result = await createPlan(formData)
          if (result.ok) {
            toast({ title: 'Plan created', description: result.message })
            setOpen(false)
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message })
          }
        })
      }
    >
      <p className="label-meta text-faint">New plan</p>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">Display name</span>
          <Input name="display_name" required maxLength={60} placeholder="Growth" />
        </label>

        <label className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">Tier</span>
          <select name="tier" className={selectCls} defaultValue="growth">
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-muted-foreground block text-xs">Description (optional)</span>
        <Input name="description" maxLength={200} placeholder="For growing teams" />
      </label>

      <label className="block space-y-1.5">
        <span className="text-muted-foreground block text-xs">
          Organization id — leave blank for a public catalogue plan
        </span>
        <Input name="organization_id" placeholder="" className="font-mono text-xs" />
      </label>
      <p className="text-faint text-xs">
        Limits and features are copied from the newest public plan on the chosen tier, so a new
        plan is never created granting nothing.
      </p>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          Create plan
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function NewPriceForm({
  planId,
  planName,
  monthlyByCurrency,
}: {
  planId: string
  planName: string
  /** Existing monthly price per currency, in minor units. Drives the annual default. */
  monthlyByCurrency: Record<string, number>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [currency, setCurrency] = useState('INR')
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly')
  const [amount, setAmount] = useState('')
  /** False once the operator types, so their figure is never overwritten. */
  const [autofilled, setAutofilled] = useState(true)

  const monthlyMinor = monthlyByCurrency[currency.toUpperCase()] ?? 0
  const baselineMinor = monthlyMinor * 12

  /*
   * An annual price starts at twelve months of the monthly one and stays fully
   * editable — the default is the no-discount case, so any saving is a
   * deliberate decision rather than an accident of arithmetic.
   */
  function retarget(nextInterval: 'monthly' | 'annual', nextCurrency: string) {
    const monthly = monthlyByCurrency[nextCurrency.toUpperCase()] ?? 0
    if (!autofilled) return
    setAmount(nextInterval === 'annual' && monthly > 0 ? ((monthly * 12) / 100).toFixed(2) : '')
  }

  const entered = Math.round(Number(amount) * 100)
  const discountPct =
    interval === 'annual' && baselineMinor > 0 && Number.isFinite(entered) && amount !== ''
      ? Math.round(((baselineMinor - entered) / baselineMinor) * 1000) / 10
      : null

  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Add price
      </Button>
    )
  }

  return (
    <form
      className="space-y-2 py-3"
      action={(formData) =>
        startTransition(async () => {
          formData.set('plan_id', planId)
          const result = await createPlanPrice(formData)
          if (result.ok) {
            toast({ title: `Price added to ${planName}` })
            setOpen(false)
            setAmount('')
            setAutofilled(true)
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message })
          }
        })
      }
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-24 space-y-1">
          <span className="label-meta text-faint block">Currency</span>
          <Input
            name="currency"
            required
            maxLength={3}
            value={currency}
            className="uppercase"
            onChange={(e) => {
              setCurrency(e.target.value)
              retarget(interval, e.target.value)
            }}
          />
        </label>

        <label className="w-28 space-y-1">
          <span className="label-meta text-faint block">Interval</span>
          <select
            name="billing_interval"
            className={selectCls}
            value={interval}
            onChange={(e) => {
              const next = e.target.value as 'monthly' | 'annual'
              setInterval(next)
              retarget(next, currency)
            }}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </label>

        <label className="w-28 space-y-1">
          <span className="label-meta text-faint block">Per seat</span>
          <Input
            name="unit_amount_major"
            required
            inputMode="decimal"
            placeholder="499.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setAutofilled(false)
            }}
          />
        </label>

        <Button type="submit" size="sm" loading={pending}>
          Add
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            setAutofilled(true)
          }}
        >
          Cancel
        </Button>
      </div>

      {interval === 'annual' ? (
        baselineMinor > 0 ? (
          <p className="text-xs tabular-nums">
            <span className="text-faint">12 × monthly = {(baselineMinor / 100).toFixed(2)} · </span>
            {discountPct === null ? (
              <span className="text-muted-foreground">enter an amount</span>
            ) : discountPct > 0 ? (
              <span className="text-success">{discountPct}% off</span>
            ) : discountPct < 0 ? (
              <span className="text-destructive">
                {Math.abs(discountPct)}% MORE than paying monthly
              </span>
            ) : (
              <span className="text-muted-foreground">no discount</span>
            )}
          </p>
        ) : (
          <p className="text-faint text-xs">
            No monthly {currency.toUpperCase()} price to compare against — add one first and the
            annual figure will default to twelve months of it.
          </p>
        )
      ) : null}

      <p className="text-faint text-xs">
        Tax-inclusive: this is what the customer is charged.
      </p>
    </form>
  )
}
