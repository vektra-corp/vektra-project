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

export function NewPriceForm({ planId, planName }: { planId: string; planName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        Add price
      </Button>
    )
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 py-3"
      action={(formData) =>
        startTransition(async () => {
          formData.set('plan_id', planId)
          const result = await createPlanPrice(formData)
          if (result.ok) {
            toast({ title: `Price added to ${planName}` })
            setOpen(false)
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message })
          }
        })
      }
    >
      <label className="w-24 space-y-1">
        <span className="label-meta text-faint block">Currency</span>
        <Input name="currency" required maxLength={3} defaultValue="INR" className="uppercase" />
      </label>

      <label className="w-28 space-y-1">
        <span className="label-meta text-faint block">Interval</span>
        <select name="billing_interval" className={selectCls} defaultValue="monthly">
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
      </label>

      <label className="w-28 space-y-1">
        <span className="label-meta text-faint block">Per seat</span>
        <Input name="unit_amount_major" required inputMode="decimal" placeholder="499.00" />
      </label>

      <Button type="submit" size="sm" loading={pending}>
        Add
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}
