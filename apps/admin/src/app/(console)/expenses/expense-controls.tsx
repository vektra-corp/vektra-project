'use client'

import { Button, Input, toast } from '@pm/ui'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { deleteExpense, recordExpense } from './actions'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL as LABEL } from './constants'

const selectCls =
  'h-9 w-full rounded-md border border-input bg-surface-raised px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

export function ExpenseForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card"
      action={(formData) =>
        startTransition(async () => {
          const result = await recordExpense(formData)
          if (result.ok) {
            toast({ title: 'Expense recorded' })
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message })
          }
        })
      }
    >
      <p className="label-meta text-faint">Record an expense</p>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">Category</span>
          <select name="category" className={selectCls} defaultValue="infrastructure">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LABEL[c] ?? c}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">Date incurred</span>
          <Input type="date" name="incurred_on" required defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-muted-foreground block text-xs">Description</span>
        <Input name="description" required maxLength={200} placeholder="Supabase Pro — September" />
      </label>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">Currency</span>
          <Input name="currency" required maxLength={3} defaultValue="INR" className="uppercase" />
        </label>

        <label className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">Amount</span>
          <Input name="amount_major" required inputMode="decimal" placeholder="2075.00" />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-muted-foreground block text-xs">Notes (optional)</span>
        <Input name="notes" maxLength={300} />
      </label>

      <Button type="submit" size="sm" loading={pending}>
        Record
      </Button>
    </form>
  )
}

export function ExpenseRowActions({ id, description }: { id: string; description: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${description}`}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteExpense(id)
          if (result.ok) {
            toast({ title: 'Expense removed' })
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message })
          }
        })
      }
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </Button>
  )
}
