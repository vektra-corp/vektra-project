'use client'

import { Button, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setFlagEnabled } from '../actions'

export function FlagToggle({
  id,
  isEnabled,
  disabled,
}: {
  id: string
  isEnabled: boolean
  disabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant={isEnabled ? 'subtle' : 'ghost'}
      size="xs"
      loading={pending}
      disabled={disabled}
      aria-pressed={isEnabled}
      onClick={() =>
        startTransition(async () => {
          const result = await setFlagEnabled(id, !isEnabled)
          if (result.ok) router.refresh()
          else toast({ variant: 'destructive', title: 'Failed', description: result.message })
        })
      }
    >
      {isEnabled ? 'Disable' : 'Enable'}
    </Button>
  )
}
