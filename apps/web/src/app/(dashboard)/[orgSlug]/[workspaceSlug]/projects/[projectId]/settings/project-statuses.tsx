'use client'

import { isLastProtectedColumn, TASK_STATUSES } from '@pm/shared/constants'
import { Button, Input, toast } from '@pm/ui'
import { Lock, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateKanbanColumn } from '../actions'
import { createProjectStatus, deleteProjectStatus } from './actions'

export interface StatusColumn {
  id: string
  name: string
  status: string
  position: number
  taskCount: number
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
}

/**
 * The project's statuses, which are its board columns (business rule 3).
 *
 * Each row is a column people drag cards into. The second control is the
 * canonical status it maps to, and it is the part that makes custom statuses
 * safe: a project can call something "Blocked" or "In QA", and reporting, the
 * overdue job and the completion counters still know whether that means open or
 * finished. Without the mapping, every custom status would be invisible to
 * everything outside the board.
 *
 * To do, In progress and Done cannot be removed — renaming them is the
 * supported way to change the vocabulary.
 */
export function ProjectStatuses({
  scope,
  columns,
  canEdit,
}: {
  scope: { orgSlug: string; workspaceSlug: string; projectId: string }
  columns: StatusColumn[]
  canEdit: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<string>('in_progress')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function rename(column: StatusColumn, next: string) {
    const trimmed = next.trim()
    if (!trimmed || trimmed === column.name) return

    startTransition(async () => {
      const result = await updateKanbanColumn(scope, column.id, { name: trimmed })
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not rename', description: result.message })
        return
      }
      router.refresh()
    })
  }

  function add() {
    const trimmed = name.trim()
    if (!trimmed) return

    startTransition(async () => {
      const result = await createProjectStatus(scope, { name: trimmed, status })
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not add status', description: result.message })
        return
      }
      setName('')
      setAdding(false)
      toast({ title: `Added “${trimmed}”` })
      router.refresh()
    })
  }

  function remove(column: StatusColumn) {
    startTransition(async () => {
      const result = await deleteProjectStatus(scope, column.id)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not remove', description: result.message })
        return
      }
      toast({
        title: `Removed “${column.name}”`,
        description:
          result.data.movedTasks > 0
            ? `${result.data.movedTasks} task${result.data.movedTasks === 1 ? '' : 's'} moved to To do.`
            : undefined,
      })
      router.refresh()
    })
  }

  return (
    <section className="border-border bg-surface shadow-card rounded-lg border">
      <div className="border-border-subtle border-b px-5 py-4">
        <h2 className="text-ui font-semibold">Statuses</h2>
        <p className="text-muted-foreground pt-1 text-base">
          These are the columns on this project’s board. To do, In progress and Done are built in
          and can be renamed but not removed.
        </p>
      </div>

      <ul className="divide-border-subtle divide-y">
        {columns.map((column) => {
          // Locked only while it is the last column of a built-in status: a
          // project that adds "Blocked" beside "In Progress" can still remove
          // "Blocked" again.
          const sharing = columns.filter((other) => other.status === column.status).length
          const locked = isLastProtectedColumn(column.status, sharing)
          return (
            <li key={column.id} className="flex items-center gap-3 px-5 py-3">
              <Input
                defaultValue={column.name}
                disabled={!canEdit || pending}
                onBlur={(event) => rename(column, event.target.value)}
                aria-label={`Name for ${column.name}`}
                className="max-w-[220px]"
              />

              <span className="text-muted-foreground shrink-0 text-nav">
                behaves as{' '}
                <span className="text-foreground font-medium">
                  {STATUS_LABELS[column.status] ?? column.status}
                </span>
              </span>

              <span className="text-faint ms-auto shrink-0 font-mono text-[10.5px] tabular-nums">
                {column.taskCount} {column.taskCount === 1 ? 'task' : 'tasks'}
              </span>

              {locked ? (
                <span
                  className="text-faint shrink-0"
                  title="The only column for a built-in status — rename it, but it cannot be removed"
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">Built in</span>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canEdit || pending}
                  onClick={() => remove(column)}
                  aria-label={`Remove ${column.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              )}
            </li>
          )
        })}
      </ul>

      {canEdit ? (
        <div className="border-border-subtle border-t px-5 py-3.5">
          {adding ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <Input
                autoFocus
                value={name}
                placeholder="Blocked"
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') add()
                  if (event.key === 'Escape') setAdding(false)
                }}
                className="max-w-[220px]"
                aria-label="New status name"
              />
              {/* Native select, matching SelectField elsewhere in settings —
                  the Radix one in @pm/ui is for richer menus than a five-item
                  enum. */}
              <select
                value={status}
                disabled={pending}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Behaves as"
                className="border-input bg-card focus-visible:ring-ring/60 h-9 max-w-[160px] rounded-md border px-3 text-ui transition-colors focus-visible:outline-none focus-visible:ring-2"
              >
                {TASK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {STATUS_LABELS[option] ?? option}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={add} loading={pending}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add status
            </Button>
          )}
        </div>
      ) : null}
    </section>
  )
}
