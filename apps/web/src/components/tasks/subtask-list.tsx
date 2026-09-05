'use client'

import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Button, cn } from '@pm/ui'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import {
  createSubtask,
  toggleSubtask,
} from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'

export interface SubtaskRow {
  id: string
  title: string
  status: string
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
}

/**
 * Subtask checklist.
 *
 * Business rule 2: two levels only. There is no "add subtask" inside a subtask
 * here because the schema has no column that would store it.
 */
export function SubtaskList({
  scope,
  taskId,
  subtasks,
  canEdit,
}: {
  scope: KanbanScope
  taskId: string
  subtasks: SubtaskRow[]
  canEdit: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const done = subtasks.filter((s) => s.status === 'done' || s.status === 'cancelled').length
  const percent = subtasks.length === 0 ? 0 : Math.round((done / subtasks.length) * 100)

  function add() {
    const title = inputRef.current?.value.trim()
    if (!title) return
    const formData = new FormData()
    formData.set('title', title)

    startTransition(async () => {
      await createSubtask(scope, taskId, null, formData)
      if (inputRef.current) inputRef.current.value = ''
      inputRef.current?.focus()
      router.refresh()
    })
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ui font-medium">
          Subtasks{' '}
          <span className="tabular-nums text-muted-foreground">
            {done}/{subtasks.length}
          </span>
        </h2>
        {subtasks.length > 0 ? (
          <div
            className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Subtask progress"
          >
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>

      <ul className="space-y-1">
        {subtasks.map((subtask) => {
          const isDone = subtask.status === 'done'
          return (
            <li key={subtask.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <input
                type="checkbox"
                checked={isDone}
                disabled={!canEdit || pending}
                aria-label={subtask.title}
                className="h-4 w-4 rounded border-input"
                onChange={(event) => {
                  const next = event.target.checked
                  startTransition(async () => {
                    await toggleSubtask(scope, subtask.id, next)
                    router.refresh()
                  })
                }}
              />
              <span className={cn('flex-1 text-ui', isDone && 'text-muted-foreground line-through')}>
                {subtask.title}
              </span>
              {subtask.assignee ? (
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[9px]">
                    {initials(subtask.assignee.full_name)}
                  </AvatarFallback>
                </Avatar>
              ) : null}
            </li>
          )
        })}
      </ul>

      {canEdit ? (
        adding ? (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              placeholder="Subtask title"
              aria-label="Subtask title"
              disabled={pending}
              className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add()
                }
                if (event.key === 'Escape') setAdding(false)
              }}
            />
            <Button size="sm" loading={pending} onClick={add}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              setAdding(true)
              requestAnimationFrame(() => inputRef.current?.focus())
            }}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add subtask
          </Button>
        )
      ) : null}
    </section>
  )
}
