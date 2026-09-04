'use client'

import { Button, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { createNotice, setNoticeActive } from '../actions'

export function NoticeToggle({
  id,
  isActive,
  disabled,
}: {
  id: string
  isActive: boolean
  disabled: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant={isActive ? 'subtle' : 'ghost'}
      size="xs"
      loading={pending}
      disabled={disabled}
      onClick={() =>
        startTransition(async () => {
          const result = await setNoticeActive(id, !isActive)
          if (result.ok) router.refresh()
          else toast({ variant: 'destructive', title: 'Failed', description: result.message })
        })
      }
    >
      {isActive ? 'Deactivate' : 'Activate'}
    </Button>
  )
}

export function NoticeForm() {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-card"
      action={(formData) =>
        startTransition(async () => {
          const result = await createNotice(formData)
          if (result.ok) {
            toast({ title: 'Notice published' })
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Failed', description: result.message })
          }
        })
      }
    >
      <p className="label-meta text-faint">New notice</p>

      <input
        name="title"
        required
        maxLength={200}
        placeholder="Title"
        className="h-9 w-full rounded-md border border-input bg-surface-raised px-3 text-sm placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      <textarea
        name="body"
        required
        rows={3}
        maxLength={2000}
        placeholder="What should every tenant know?"
        className="w-full resize-y rounded-md border border-input bg-surface-raised px-3 py-2 text-sm placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="label-meta block text-faint">Type</span>
          <select
            name="type"
            defaultValue="info"
            className="h-9 rounded-md border border-input bg-surface-raised px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="label-meta block text-faint">Ends at (optional)</span>
          <input
            name="ends_at"
            type="datetime-local"
            className="h-9 rounded-md border border-input bg-surface-raised px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          />
        </label>

        <Button type="submit" size="sm" loading={pending} className="ms-auto">
          Publish
        </Button>
      </div>
    </form>
  )
}
