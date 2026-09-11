'use client'

import { Checkbox, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { setWorkspaceDelegation } from '../actions'

/**
 * Delegate workspace creation to managers.
 *
 * Admin-only, because it is a decision about who else gets a power — a manager
 * must not be able to grant it to themselves. The flag is read by
 * `can_create_workspace()` in the database as well as by this app, so turning
 * it on genuinely changes what the database permits rather than only what the
 * UI offers.
 */
export function WorkspaceDelegation({
  orgSlug,
  enabled,
}: {
  orgSlug: string
  enabled: boolean
}) {
  const [value, setValue] = useState(enabled)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggle(next: boolean) {
    setValue(next)

    startTransition(async () => {
      const result = await setWorkspaceDelegation(orgSlug, next)
      if (!result.ok) {
        setValue(!next)
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
        return
      }
      toast({
        title: next ? 'Managers can create workspaces' : 'Only admins can create workspaces',
      })
      router.refresh()
    })
  }

  return (
    <section className="border-border bg-surface shadow-card mt-6 rounded-lg border">
      <label className="flex cursor-pointer items-start justify-between gap-6 px-5 py-4">
        <span className="min-w-0">
          <span className="block text-ui font-medium">Let managers create workspaces</span>
          <span className="text-muted-foreground block pt-1 text-base leading-relaxed">
            Off by default. Renaming, restructuring and deleting workspaces stays with admins
            either way.
          </span>
        </span>
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={value}
          disabled={pending}
          onChange={(event) => toggle(event.target.checked)}
          aria-label="Let managers create workspaces"
        />
      </label>
    </section>
  )
}
