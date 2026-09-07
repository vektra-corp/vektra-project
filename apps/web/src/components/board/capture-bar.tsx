'use client'

import { cn } from '@pm/ui'
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
    /*
     * The design gives capture its own strip under the section header: a panel
     * ground, a card-coloured field inside it, and the parsed result on a second
     * line beneath. The parse preview is part of the strip rather than crammed
     * into the field, so a long title never pushes the chips out of view.
     */
    <div className="border-border bg-surface flex shrink-0 flex-col border-b px-5 py-3">
      <div
        className={cn(
          'border-input bg-card flex items-center gap-2.5 rounded-[10px] border px-3 py-[9px] transition-colors',
          'focus-within:border-ring',
          error && 'border-destructive/50',
        )}
      >
        <span aria-hidden className="text-primary font-glyph shrink-0 text-base">
          ＋
        </span>
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
          className="placeholder:text-faint min-w-0 flex-1 bg-transparent text-task outline-none disabled:opacity-50"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!parsed.title || pending}
          className="border-input text-subtle hover:text-foreground shrink-0 rounded-[4px] border px-1.5 py-0.5 font-mono text-id uppercase transition-colors disabled:opacity-50"
        >
          ⏎ Create
        </button>
      </div>

      {hints.length > 0 || error ? (
        <div className="flex min-h-5 items-center gap-[7px] px-1 pt-[9px]">
          <span className="label-meta-lg text-subtle shrink-0">Parsed</span>
          <ul className="flex flex-wrap items-center gap-[7px]">
            {hints.map((hint) => (
              <li
                key={hint.key}
                className="border-border bg-chip text-muted-foreground flex items-center gap-1.5 rounded-[6px] border px-2 py-[3px] text-micro"
              >
                <span className="text-subtle font-mono text-[8.5px] uppercase tracking-[0.1em]">
                  {hint.kind}
                </span>
                <span className="text-foreground">{hint.text}</span>
              </li>
            ))}
          </ul>
          {error ? <span className="text-destructive ms-auto text-micro">{error}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
