'use client'

import { Button } from '@pm/ui'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { createTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from './types'

/** Inline "add a card" at the foot of a column. */
export function KanbanQuickAdd({ scope, columnId }: { scope: KanbanScope; columnId: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  function submit() {
    const title = inputRef.current?.value.trim()
    if (!title) return

    const formData = new FormData()
    formData.set('title', title)
    formData.set('kanban_column_id', columnId)

    startTransition(async () => {
      const result = await createTask(scope, null, formData)
      if (result.ok) {
        setError(null)
        if (inputRef.current) inputRef.current.value = ''
        // Keep the composer open so several cards can be added in a row.
        inputRef.current?.focus()
        router.refresh()
      } else {
        setError(result.message === 'VALIDATION_ERROR' ? 'Enter a title' : result.message)
      }
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start text-muted-foreground"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add a card
      </Button>
    )
  }

  return (
    <div className="rounded-md border bg-card p-2">
      <textarea
        ref={inputRef}
        rows={2}
        placeholder="What needs doing?"
        aria-label="Task title"
        disabled={pending}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onKeyDown={(event) => {
          // Enter submits, Shift+Enter would be a newline the title cannot hold.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {error ? <p className="pb-1 text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" loading={pending} onClick={submit}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
