'use client'

import { Button, Kbd, cn } from '@pm/ui'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { createTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'
import { parseCapture, describeCapture } from './parse-capture'

/**
 * Quick capture.
 *
 * Accepts inline syntax — `@assignee`, `#label`, `!priority`, `~points`, and a
 * trailing due date — so a task can be filed without leaving the board. Parsing
 * happens here for the live preview, and again on the server, which is the copy
 * that decides: the client's reading of the text is a convenience, not an input
 * the database will trust.
 */
export function CaptureBar({
  scope,
  columnId,
  assignees,
  labels,
}: {
  scope: KanbanScope
  /** Column new tasks land in — the first column of the board. */
  columnId: string | null
  assignees: { id: string; full_name: string }[]
  labels: { id: string; name: string }[]
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // "C" focuses capture, the way an issue tracker's create shortcut does.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const parsed = parseCapture(value, { assignees, labels })
  const hints = describeCapture(parsed)

  function submit() {
    if (!parsed.title) return

    const formData = new FormData()
    formData.set('title', parsed.title)
    if (columnId) formData.set('kanban_column_id', columnId)
    if (parsed.priority) formData.set('priority', parsed.priority)
    if (parsed.assigneeId) formData.set('assignee_id', parsed.assigneeId)
    if (parsed.dueDate) formData.set('due_date', parsed.dueDate)
    if (parsed.estimatedHours !== null) {
      formData.set('estimated_hours', String(parsed.estimatedHours))
    }

    startTransition(async () => {
      const result = await createTask(scope, null, formData)
      if (result.ok) {
        setValue('')
        setError(null)
        router.refresh()
      } else {
        setError(result.message === 'VALIDATION_ERROR' ? 'Enter a title' : result.message)
      }
    })
  }

  return (
    <div className="px-5">
      <div
        className={cn(
          'border-border-subtle bg-surface flex h-11 items-center gap-2.5 rounded-lg border px-3 transition-colors',
          'focus-within:border-border',
          error && 'border-destructive/50',
        )}
      >
        <Plus className="text-faint h-4 w-4 shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
            if (event.key === 'Escape') {
              setValue('')
              inputRef.current?.blur()
            }
          }}
          disabled={pending}
          aria-label="Capture a task"
          placeholder="Capture anything — Ship read-only banner @jonas #infra !high ~3 fri"
          className="placeholder:text-faint min-w-0 flex-1 bg-transparent text-base outline-none disabled:opacity-50"
        />

        {hints.length > 0 ? (
          <ul className="hidden shrink-0 items-center gap-1.5 lg:flex">
            {hints.map((hint) => (
              <li key={hint.key} className={cn('label-meta rounded px-1.5 py-1', hint.className)}>
                {hint.text}
              </li>
            ))}
          </ul>
        ) : null}

        <Button
          type="button"
          variant="subtle"
          size="xs"
          className="label-meta shrink-0 gap-1.5 px-2"
          onClick={submit}
          loading={pending}
          disabled={!parsed.title}
        >
          {pending ? null : <Kbd className="h-4 min-w-0 border-0 bg-transparent px-0">⏎</Kbd>}
          Create
        </Button>
      </div>
      {error ? <p className="text-destructive pt-1.5 text-nav">{error}</p> : null}
    </div>
  )
}
