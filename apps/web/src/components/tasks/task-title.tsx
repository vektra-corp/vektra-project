'use client'

import { Button, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { patchTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'

/**
 * The task's title, renameable in place.
 *
 * Click-to-edit rather than a pencil affordance: the heading is the one field
 * on this page that is always present and always the thing being talked about,
 * so making it directly editable costs nothing and skips a step. Enter commits,
 * Escape abandons, and blur commits too — a rename left half-typed in a field
 * nobody submitted is the failure this avoids.
 *
 * An empty or unchanged value is a no-op rather than an error: clearing the
 * field is far more likely to be a mistake than a request to store "".
 */
export function TaskTitle({
  scope,
  taskId,
  title,
  canEdit,
}: {
  scope: KanbanScope
  taskId: string
  title: string
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [pending, startTransition] = useTransition()
  const input = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()

  // Re-seed when the server sends a different title (another editor, a refresh).
  const [seed, setSeed] = useState(title)
  if (seed !== title) {
    setSeed(title)
    if (!editing) setValue(title)
  }

  function commit() {
    const next = value.trim()
    setEditing(false)

    if (!next || next === title) {
      setValue(title)
      return
    }

    startTransition(async () => {
      const result = await patchTask(scope, taskId, { title: next })
      if (result.ok) {
        router.refresh()
        return
      }
      // Put the old title back rather than leaving the heading showing a name
      // the database refused.
      setValue(title)
      toast({
        variant: 'destructive',
        title: 'Could not rename this task',
        description: result.message,
      })
    })
  }

  if (!editing || !canEdit) {
    return (
      <h1
        className={
          'text-[22px] font-semibold leading-tight tracking-[-0.02em] ' +
          (canEdit
            ? 'hover:bg-surface-hover -mx-1.5 cursor-text rounded-md px-1.5 transition-colors'
            : '')
        }
        // A heading is not a control, so it needs an explicit role and key
        // handler to be reachable without a pointer.
        {...(canEdit
          ? {
              role: 'button',
              tabIndex: 0,
              title: 'Rename this task',
              onClick: () => setEditing(true),
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setEditing(true)
                }
              },
            }
          : {})}
      >
        {value}
      </h1>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="task-title-input">
        Task title
      </label>
      <textarea
        id="task-title-input"
        ref={input}
        autoFocus
        rows={2}
        maxLength={300}
        value={value}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setValue(title)
            setEditing(false)
          }
        }}
        className="border-input bg-background focus-visible:ring-ring/60 -mx-1.5 resize-none rounded-md border px-1.5 py-1 text-[22px] font-semibold leading-tight tracking-[-0.02em] focus-visible:outline-none focus-visible:ring-2"
      />
      <div className="flex items-center gap-2">
        {/* Mousedown, not click: blur fires first and would commit twice. */}
        <Button size="sm" loading={pending} onMouseDown={(event) => event.preventDefault()} onClick={commit}>
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setValue(title)
            setEditing(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
