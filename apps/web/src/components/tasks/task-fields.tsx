'use client'

import type { Priority, TaskStatus } from '@pm/shared/constants'
import { humanize } from '@pm/shared/utils'
import { Label } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'

interface Member {
  id: string
  full_name: string
  avatar_url: string | null
}

interface FieldValues {
  status: string
  priority: string
  assignee_id: string
  due_date: string
  start_date: string
  estimated_hours: number | null
}

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-ui shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/**
 * Inline task fields. Each control saves on change rather than behind a Save
 * button — this is the panel people keep open while working, and a lost edit is
 * worse than an extra round trip.
 */
export function TaskFields({
  scope,
  taskId,
  canEdit,
  statuses,
  priorities,
  members,
  value,
}: {
  scope: KanbanScope
  taskId: string
  canEdit: boolean
  statuses: readonly TaskStatus[]
  priorities: readonly Priority[]
  members: Member[]
  value: FieldValues
}) {
  const [fields, setFields] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function save(patch: Partial<FieldValues>) {
    const next = { ...fields, ...patch }
    const previous = fields
    setFields(next)

    const formData = new FormData()
    formData.set('status', next.status)
    formData.set('priority', next.priority)
    formData.set('assignee_id', next.assignee_id)
    formData.set('due_date', next.due_date)
    formData.set('start_date', next.start_date)
    if (next.estimated_hours !== null) {
      formData.set('estimated_hours', String(next.estimated_hours))
    }

    startTransition(async () => {
      const result = await updateTask(scope, taskId, null, formData)
      if (!result.ok) {
        setFields(previous)
        setError(result.message === 'VALIDATION_ERROR' ? 'Check the dates' : result.message)
        return
      }
      setError(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-nav text-destructive">{error}</p> : null}

      <div className="space-y-1.5">
        <Label htmlFor="task-status" className="text-nav text-muted-foreground">
          Status
        </Label>
        <select
          id="task-status"
          className={selectClass}
          value={fields.status}
          disabled={!canEdit || pending}
          onChange={(event) => save({ status: event.target.value })}
        >
          {statuses.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-priority" className="text-nav text-muted-foreground">
          Priority
        </Label>
        <select
          id="task-priority"
          className={selectClass}
          value={fields.priority}
          disabled={!canEdit || pending}
          onChange={(event) => save({ priority: event.target.value })}
        >
          {priorities.map((priority) => (
            <option key={priority} value={priority}>
              {humanize(priority)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-assignee" className="text-nav text-muted-foreground">
          Assignee
        </Label>
        <select
          id="task-assignee"
          className={selectClass}
          value={fields.assignee_id}
          disabled={!canEdit || pending}
          onChange={(event) => save({ assignee_id: event.target.value })}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="task-start" className="text-nav text-muted-foreground">
            Start
          </Label>
          <input
            id="task-start"
            type="date"
            className={selectClass}
            value={fields.start_date}
            disabled={!canEdit || pending}
            onChange={(event) => save({ start_date: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-due" className="text-nav text-muted-foreground">
            Due
          </Label>
          <input
            id="task-due"
            type="date"
            className={selectClass}
            value={fields.due_date}
            disabled={!canEdit || pending}
            onChange={(event) => save({ due_date: event.target.value })}
          />
        </div>
      </div>
    </div>
  )
}
