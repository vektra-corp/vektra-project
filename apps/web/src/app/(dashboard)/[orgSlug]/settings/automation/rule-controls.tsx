'use client'

import { Button, toast } from '@pm/ui'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { deleteAssignmentRule, setRuleActive } from './actions'

export function RuleToggle({
  orgSlug,
  ruleId,
  isActive,
}: {
  orgSlug: string
  ruleId: string
  isActive: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant={isActive ? 'subtle' : 'ghost'}
      size="xs"
      loading={pending}
      aria-pressed={isActive}
      onClick={() =>
        startTransition(async () => {
          const result = await setRuleActive(orgSlug, ruleId, !isActive)
          if (result.ok) router.refresh()
          else toast({ variant: 'destructive', title: 'Failed', description: result.message })
        })
      }
    >
      {isActive ? 'Pause' : 'Activate'}
    </Button>
  )
}

export function DeleteRuleButton({ orgSlug, ruleId }: { orgSlug: string; ruleId: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete rule"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await deleteAssignmentRule(orgSlug, ruleId)
          if (result.ok) {
            toast({ title: 'Rule deleted' })
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
