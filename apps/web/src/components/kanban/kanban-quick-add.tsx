'use client'

import { Button, cn } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { createTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from './types'

/** Inline "add an issue" at the foot of a column. */
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
    // The design's end-of-column row: a dashed 9px-radius slot at card width
    // that is also where a dragged card lands, so the affordance and the drop
    // target are the same object.
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        className="border-input text-subtle hover:border-primary hover:text-primary hover:bg-primary/[0.07] w-full rounded-[9px] border border-dashed px-3 py-2.5 text-start text-ui transition-colors"
      >
        <span aria-hidden className="font-glyph">
          ＋
        </span>{' '}
        Add issue
      </button>
    )
  }

  return (
    <div
      className={cn(
        'border-border bg-card rounded-[9px] border p-2',
        error && 'border-destructive/50',
      )}
    >
      <textarea
        ref={inputRef}
        rows={2}
        placeholder="What needs doing?"
        aria-label="Task title"
        disabled={pending}
        className="placeholder:text-faint w-full resize-none bg-transparent text-base leading-snug outline-none"
        onKeyDown={(event) => {
          // Enter submits, Shift+Enter would be a newline the title cannot hold.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      {error ? <p className="text-destructive pb-1 text-nav">{error}</p> : null}
      <div className="flex items-center gap-1.5 pt-1">
        <Button type="button" size="xs" loading={pending} onClick={submit}>
          Add
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
