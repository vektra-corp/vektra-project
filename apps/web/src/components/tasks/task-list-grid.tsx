'use client'

import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from '@pm/shared/constants'
import { initials } from '@pm/shared/utils'
import { cn, toast } from '@pm/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  createTask,
  deleteTask,
  patchTask,
  setTaskDone,
} from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import type { KanbanScope } from '@/components/kanban/types'
import { InlineSelect, type InlineOption } from './inline-select'

/**
 * The design's list grid: eight tracks, sized exactly as it sizes them.
 *
 * Held in one constant because the header, every task row, every subtask row
 * and the add row all have to line up, and a template repeated five times drifts
 * the first time one of them is edited.
 */
const GRID = 'grid-cols-[78px_2fr_104px_96px_104px_104px_112px_26px] gap-3'

const STATUS_META: Record<TaskStatus, { label: string; short: string; color: string }> = {
  todo: { label: 'To Do', short: 'TO DO', color: 'hsl(var(--status-backlog))' },
  in_progress: { label: 'In Progress', short: 'ACTIVE', color: 'hsl(var(--status-progress))' },
  in_review: { label: 'In Review', short: 'REVIEW', color: 'hsl(var(--status-review))' },
  done: { label: 'Done', short: 'DONE', color: 'hsl(var(--status-done))' },
  cancelled: { label: 'Cancelled', short: 'CANCELLED', color: 'hsl(var(--subtle))' },
}

const PRIORITY_META: Record<Priority, { label: string; short: string; color: string }> = {
  critical: { label: '▲▲ URGENT', short: 'URGENT', color: 'hsl(var(--priority-critical))' },
  high: { label: '▲ HIGH', short: 'HIGH', color: 'hsl(var(--priority-high))' },
  medium: { label: '— MED', short: 'MED', color: 'hsl(var(--priority-medium))' },
  low: { label: '▽ LOW', short: 'LOW', color: 'hsl(var(--priority-low))' },
}

const STATUS_OPTIONS: InlineOption[] = TASK_STATUSES.map((status) => ({
  value: status,
  label: STATUS_META[status].label,
  color: STATUS_META[status].color,
}))

const PRIORITY_OPTIONS: InlineOption[] = PRIORITIES.map((priority) => ({
  value: priority,
  label: PRIORITY_META[priority].label,
  inkColor: PRIORITY_META[priority].color,
}))

/** Relative due dates the design offers, resolved against the org's today. */
function dueOptions(today: string): InlineOption[] {
  const base = new Date(`${today}T00:00:00Z`)
  const shift = (days: number) => {
    const date = new Date(base)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }
  return [
    { value: shift(0), label: 'Today' },
    { value: shift(1), label: 'Tomorrow' },
    { value: shift(7), label: 'Next week' },
    { value: shift(30), label: 'In a month' },
    { value: '', label: 'No due date' },
  ]
}

export interface ListSubtask {
  id: string
  title: string
  status: TaskStatus
  priority: Priority
  due_date: string | null
  assignee: { id: string; full_name: string } | null
}

export interface ListTask {
  /** Task uuid — what a write is addressed to. */
  id: string
  /** 16-digit public id — what the row links to. */
  publicId: string
  title: string
  taskNumber: number
  status: TaskStatus
  priority: Priority
  due_date: string | null
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
  assigner: { id: string; full_name: string } | null
  subtasks: ListSubtask[]
}

export interface ListGroup {
  key: string
  label: string
  color: string
  tasks: ListTask[]
  /** Status a task added in this group takes; null when grouped by something else. */
  addStatus: TaskStatus | null
  /** Column a task added in this group lands in, when grouping is by status. */
  addColumnId: string | null
}

function shortDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00Z`)
  return date
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase()
}

export function TaskListGrid({
  scope,
  projectKey,
  groups,
  people,
  today,
  base,
  canEdit,
  canDelete,
  sortKey,
  sortOrder,
  onSort,
}: {
  scope: KanbanScope
  /** The project's chosen key — the VEK in VEK-241 (§18 rule 3). */
  projectKey: string
  groups: ListGroup[]
  people: { id: string; full_name: string }[]
  today: string
  base: string
  canEdit: boolean
  canDelete: boolean
  sortKey: string
  sortOrder: 'asc' | 'desc'
  onSort: (key: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const peopleOptions: InlineOption[] = [
    { value: '', label: 'Unassigned' },
    ...people.map((person) => ({ value: person.id, label: person.full_name })),
  ]
  const dues = dueOptions(today)

  function apply(taskId: string, patch: Parameters<typeof patchTask>[2]) {
    startTransition(async () => {
      const result = await patchTask(scope, taskId, patch)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not update', description: result.message })
        return
      }
      router.refresh()
    })
  }

  const headers = [
    { key: 'task_number', label: 'ID' },
    { key: 'title', label: 'TASK' },
    { key: 'status', label: 'STATUS' },
    { key: 'priority', label: 'PRIORITY' },
    { key: 'assignee', label: 'ASSIGNEE' },
    { key: 'assigner', label: 'ASSIGNED BY' },
    { key: 'due_date', label: 'DUE' },
    { key: '', label: '' },
  ]

  return (
    <div
      className={cn('scrollbar-slim min-h-0 flex-1 overflow-y-auto', pending && 'opacity-80')}
      data-pending={pending ? '' : undefined}
    >
      <div
        className={cn(
          'border-border bg-background label-meta-lg text-subtle sticky top-0 z-[3] grid border-b px-5 py-2.5',
          GRID,
        )}
      >
        {headers.map((header) =>
          header.key ? (
            <button
              key={header.key}
              type="button"
              onClick={() => onSort(header.key)}
              className={cn(
                'flex items-center gap-1.5 text-start transition-colors',
                sortKey === header.key ? 'text-muted-foreground' : 'hover:text-faint',
              )}
            >
              {header.label}
              {sortKey === header.key ? (
                <span aria-hidden className="text-[7px]">
                  {sortOrder === 'asc' ? '▲' : '▼'}
                </span>
              ) : null}
            </button>
          ) : (
            <span key="actions" />
          ),
        )}
      </div>

      {groups.map((group) => (
        <div key={group.key} className="flex flex-col">
          <div className="border-border flex items-center gap-[9px] border-b px-5 py-[11px]">
            <span
              aria-hidden
              className="h-[5px] w-[5px] shrink-0 rounded-full"
              style={{ backgroundColor: group.color }}
            />
            <h3 className="text-muted-foreground font-mono text-id uppercase tracking-[0.12em]">
              {group.label}
            </h3>
            <span className="text-subtle font-mono text-id tabular-nums">{group.tasks.length}</span>
          </div>

          {group.tasks.map((task) => {
            const closed = task.status === 'done' || task.status === 'cancelled'
            const isOpen = Boolean(expanded[task.id])

            return (
              <div key={task.id} className="flex flex-col">
                <div className={cn('border-border grid items-center border-b px-5 py-2.5', GRID)}>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((current) => ({ ...current, [task.id]: !current[task.id] }))
                      }
                      aria-label={isOpen ? 'Hide subtasks' : 'Show subtasks'}
                      aria-expanded={isOpen}
                      className={cn(
                        'text-subtle hover:text-foreground w-[9px] text-[8px] transition-colors',
                        task.subtasks.length === 0 && 'invisible',
                      )}
                    >
                      <span aria-hidden>{isOpen ? '⌄' : '›'}</span>
                    </button>

                    <label className={cn('inline-flex', !canEdit && 'pointer-events-none')}>
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={task.status === 'done'}
                        disabled={!canEdit || pending}
                        onChange={(event) => {
                          const next = event.target.checked
                          startTransition(async () => {
                            await setTaskDone(scope, task.id, next)
                            router.refresh()
                          })
                        }}
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'grid h-[13px] w-[13px] shrink-0 cursor-pointer place-items-center rounded-[4px] border-[1.5px] text-[8px] transition-colors',
                          task.status === 'done'
                            ? 'border-primary bg-primary text-[#04120F]'
                            : 'border-input text-transparent',
                          'peer-focus-visible:ring-ring/60 peer-focus-visible:ring-2',
                        )}
                      >
                        ✓
                      </span>
                      <span className="sr-only">Mark {task.title} complete</span>
                    </label>

                    <span className="text-faint font-mono text-col tabular-nums">
                      {projectKey}-{task.taskNumber}
                    </span>
                  </div>

                  <Link
                    href={`${base}/tasks/${task.publicId}`}
                    className={cn(
                      'hover:text-primary truncate text-task transition-colors',
                      closed && 'text-faint line-through',
                    )}
                  >
                    {task.title}
                  </Link>

                  <InlineSelect
                    label={`Status of ${task.title}`}
                    value={task.status}
                    options={STATUS_OPTIONS}
                    disabled={!canEdit}
                    onPick={(value) => apply(task.id, { status: value })}
                  >
                    <span
                      className="bg-chip flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-semibold"
                      style={{ color: STATUS_META[task.status].color }}
                    >
                      <span
                        aria-hidden
                        className="h-[5px] w-[5px] shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_META[task.status].color }}
                      />
                      <span className="truncate">{STATUS_META[task.status].short}</span>
                      <span aria-hidden className="text-subtle ms-auto text-[8px]">
                        ⌄
                      </span>
                    </span>
                  </InlineSelect>

                  <InlineSelect
                    label={`Priority of ${task.title}`}
                    value={task.priority}
                    options={PRIORITY_OPTIONS}
                    width={132}
                    disabled={!canEdit}
                    onPick={(value) => apply(task.id, { priority: value })}
                  >
                    <span
                      className="bg-chip flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-semibold"
                      style={{ color: PRIORITY_META[task.priority].color }}
                    >
                      <span className="truncate">{PRIORITY_META[task.priority].short}</span>
                      <span aria-hidden className="text-subtle ms-auto text-[8px]">
                        ⌄
                      </span>
                    </span>
                  </InlineSelect>

                  <InlineSelect
                    label={`Assignee of ${task.title}`}
                    value={task.assignee?.id ?? ''}
                    options={peopleOptions}
                    width={150}
                    disabled={!canEdit}
                    onPick={(value) => apply(task.id, { assignee_id: value || null })}
                  >
                    <span className="bg-chip text-muted-foreground grid h-[22px] w-[22px] shrink-0 place-items-center overflow-hidden rounded-full text-id font-semibold uppercase">
                      {task.assignee ? initials(task.assignee.full_name) : '—'}
                    </span>
                    <span className="text-faint truncate text-micro">
                      {task.assignee?.full_name.split(' ')[0] ?? 'Unassigned'}
                    </span>
                  </InlineSelect>

                  {/* Assigned-by is recorded when an assignment is made, so it
                      is shown rather than edited — an outlined avatar, which is
                      how the design distinguishes it from the assignee. */}
                  <span className="flex min-w-0 items-center gap-[7px]">
                    <span className="border-input text-faint grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border text-id uppercase">
                      {task.assigner ? initials(task.assigner.full_name) : '—'}
                    </span>
                    <span className="text-faint truncate text-micro">
                      {task.assigner?.full_name.split(' ')[0] ?? '—'}
                    </span>
                  </span>

                  <InlineSelect
                    label={`Due date of ${task.title}`}
                    value={task.due_date ?? ''}
                    options={dues}
                    align="end"
                    width={146}
                    disabled={!canEdit}
                    onPick={(value) => apply(task.id, { due_date: value || null })}
                  >
                    <span
                      className={cn(
                        'font-mono text-[10.5px] tabular-nums',
                        !closed && task.due_date && task.due_date < today
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                      )}
                    >
                      {shortDate(task.due_date)}
                    </span>
                    <span aria-hidden className="text-subtle text-[8px]">
                      ⌄
                    </span>
                  </InlineSelect>

                  {canDelete ? (
                    <DeleteRowButton scope={scope} taskId={task.id} title={task.title} />
                  ) : (
                    <span />
                  )}
                </div>

                {isOpen
                  ? task.subtasks.map((subtask, index) => (
                      <div
                        key={subtask.id}
                        className={cn(
                          'border-border bg-surface grid items-center border-b px-5 py-2',
                          GRID,
                        )}
                      >
                        <span className="text-subtle ps-[18px] font-mono text-meta tabular-nums">
                          {index + 1}
                        </span>
                        <span
                          className={cn(
                            'text-muted-foreground truncate ps-2 text-ui',
                            subtask.status === 'done' && 'line-through',
                          )}
                        >
                          {subtask.title}
                        </span>
                        <span
                          className="bg-chip flex w-full items-center gap-1.5 rounded-[6px] px-2 py-[3px] text-[10.5px] font-semibold"
                          style={{ color: STATUS_META[subtask.status].color }}
                        >
                          <span
                            aria-hidden
                            className="h-[5px] w-[5px] shrink-0 rounded-full"
                            style={{ backgroundColor: STATUS_META[subtask.status].color }}
                          />
                          <span className="truncate">{STATUS_META[subtask.status].short}</span>
                        </span>
                        <span
                          className="bg-chip flex w-full items-center rounded-[6px] px-2 py-[3px] text-[10.5px] font-semibold"
                          style={{ color: PRIORITY_META[subtask.priority].color }}
                        >
                          {PRIORITY_META[subtask.priority].short}
                        </span>
                        <span className="bg-chip text-faint grid h-5 w-5 place-items-center rounded-full text-meta uppercase">
                          {subtask.assignee ? initials(subtask.assignee.full_name) : '—'}
                        </span>
                        <span />
                        <span className="text-faint font-mono text-col tabular-nums">
                          {shortDate(subtask.due_date)}
                        </span>
                        <span />
                      </div>
                    ))
                  : null}
              </div>
            )
          })}

          {canEdit && group.addColumnId ? (
            <AddTaskRow
              scope={scope}
              group={group}
              people={people}
              peopleOptions={peopleOptions}
              dues={dues}
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}

function DeleteRowButton({
  scope,
  taskId,
  title,
}: {
  scope: KanbanScope
  taskId: string
  title: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <button
      type="button"
      title="Delete task"
      aria-label={`Delete ${title}`}
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return
        startTransition(async () => {
          const result = await deleteTask(scope, taskId)
          if (!result.ok) {
            toast({ variant: 'destructive', title: 'Could not delete', description: result.message })
            return
          }
          router.refresh()
        })
      }}
      className="text-subtle hover:bg-surface-hover hover:text-destructive grid h-[22px] w-[22px] place-items-center rounded-[6px] text-col transition-colors"
    >
      <span aria-hidden>✕</span>
    </button>
  )
}

/**
 * The row at the foot of each group that adds a task into it.
 *
 * Its status, priority, assignee and due pickers open UPWARD, because the row
 * sits at the bottom of its group and a downward menu would fall off the last
 * group entirely.
 */
function AddTaskRow({
  scope,
  group,
  people,
  peopleOptions,
  dues,
}: {
  scope: KanbanScope
  group: ListGroup
  people: { id: string; full_name: string }[]
  peopleOptions: InlineOption[]
  dues: InlineOption[]
}) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const status = group.addStatus ?? 'todo'

  function submit() {
    const trimmed = title.trim()
    if (!trimmed) return

    const formData = new FormData()
    formData.set('title', trimmed)
    formData.set('priority', priority)
    if (group.addColumnId) formData.set('kanban_column_id', group.addColumnId)
    if (assignee) formData.set('assignee_id', assignee)
    if (due) formData.set('due_date', due)

    startTransition(async () => {
      const result = await createTask(scope, null, formData)
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not add', description: result.message })
        return
      }
      setTitle('')
      router.refresh()
    })
  }

  return (
    <div className={cn('border-border grid items-center border-b px-5 py-2', GRID)}>
      <span aria-hidden className="text-subtle font-glyph ps-[18px] text-meta">
        ＋
      </span>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
        }}
        disabled={pending}
        placeholder={`Add a task to ${group.label.toLowerCase()}…`}
        aria-label={`Add a task to ${group.label}`}
        className="placeholder:text-subtle w-full bg-transparent py-[5px] text-base outline-none"
      />

      <span
        className="bg-chip flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-semibold"
        style={{ color: STATUS_META[status].color }}
      >
        <span
          aria-hidden
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ backgroundColor: STATUS_META[status].color }}
        />
        <span className="truncate">{STATUS_META[status].short}</span>
      </span>

      <InlineSelect
        label="Priority for the new task"
        value={priority}
        options={PRIORITY_OPTIONS}
        width={132}
        menuAbove
        onPick={(value) => setPriority(value as Priority)}
      >
        <span
          className="bg-chip flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] font-semibold"
          style={{ color: PRIORITY_META[priority].color }}
        >
          <span className="truncate">{PRIORITY_META[priority].short}</span>
          <span aria-hidden className="text-subtle ms-auto text-[8px]">
            ⌄
          </span>
        </span>
      </InlineSelect>

      <InlineSelect
        label="Assignee for the new task"
        value={assignee}
        options={peopleOptions}
        width={150}
        menuAbove
        onPick={setAssignee}
      >
        <span className="bg-chip text-faint grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-id uppercase">
          {assignee
            ? initials(people.find((person) => person.id === assignee)?.full_name ?? '?')
            : '—'}
        </span>
        <span className="text-subtle truncate text-micro">
          {assignee
            ? (people.find((person) => person.id === assignee)?.full_name.split(' ')[0] ?? '')
            : 'Anyone'}
        </span>
      </InlineSelect>

      <span />

      <InlineSelect
        label="Due date for the new task"
        value={due}
        options={dues}
        align="end"
        width={146}
        menuAbove
        onPick={setDue}
      >
        <span className="text-subtle font-mono text-[10.5px] tabular-nums">{shortDate(due || null)}</span>
        <span aria-hidden className="text-subtle text-[8px]">
          ⌄
        </span>
      </InlineSelect>

      <span />
    </div>
  )
}
