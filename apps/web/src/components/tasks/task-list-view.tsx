'use client'

import { PRIORITIES, TASK_STATUSES, type Priority, type TaskStatus } from '@pm/shared/constants'
import { SegmentedGroup, SegmentedItem, cn } from '@pm/ui'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { FilterChip, type FilterOption } from '@/components/board/filter-chip'
import type { KanbanScope } from '@/components/kanban/types'
import { TaskListGrid, type ListGroup, type ListTask } from './task-list-grid'

const STATUS_ORDER = TASK_STATUSES
const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'TO DO',
  in_progress: 'IN PROGRESS',
  in_review: 'IN REVIEW',
  done: 'DONE',
  cancelled: 'CANCELLED',
}
const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: 'hsl(var(--status-backlog))',
  in_progress: 'hsl(var(--status-progress))',
  in_review: 'hsl(var(--status-review))',
  done: 'hsl(var(--status-done))',
  cancelled: 'hsl(var(--subtle))',
}
const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'URGENT',
  high: 'HIGH',
  medium: 'MED',
  low: 'LOW',
}
const PRIORITY_COLOR: Record<Priority, string> = {
  critical: 'hsl(var(--priority-critical))',
  high: 'hsl(var(--priority-high))',
  medium: 'hsl(var(--priority-medium))',
  low: 'hsl(var(--priority-low))',
}

type GroupMode = 'status' | 'assignee' | 'priority'

/**
 * The list view's own chrome: grouping, search, filters, sort — and the grid.
 *
 * Search and sort are local state rather than URL params: they are a way of
 * looking through the rows in front of you, and the design gives them no
 * shareable identity. Filters ARE in the URL, so a filtered list can be sent to
 * someone (§10), and they reuse the board's own FilterChip so the two views
 * filter identically.
 */
export function TaskListView({
  scope,
  projectKey,
  tasks,
  people,
  statusColumns,
  today,
  base,
  canEdit,
  canDelete,
}: {
  scope: KanbanScope
  projectKey: string
  tasks: ListTask[]
  people: { id: string; full_name: string }[]
  /** Kanban column per status, so a task added to a group lands in the right one. */
  statusColumns: Record<string, string>
  today: string
  base: string
  canEdit: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [groupMode, setGroupMode] = useState<GroupMode>('status')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null)

  const statusFilter = searchParams.getAll('status')
  const priorityFilter = searchParams.getAll('priority')
  const assigneeFilter = searchParams.getAll('assignee')
  const assignerFilter = searchParams.getAll('assigner')
  const anyFilter =
    statusFilter.length + priorityFilter.length + assigneeFilter.length + assignerFilter.length > 0

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = tasks.filter((task) => {
      if (statusFilter.length && !statusFilter.includes(task.status)) return false
      if (priorityFilter.length && !priorityFilter.includes(task.priority)) return false
      if (assigneeFilter.length && !assigneeFilter.includes(task.assignee?.id ?? '')) return false
      if (assignerFilter.length && !assignerFilter.includes(task.assigner?.id ?? '')) return false
      if (needle) {
        const haystack = `${projectKey}-${task.taskNumber} ${task.title}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })

    if (!sort) return filtered

    const direction = sort.order === 'asc' ? 1 : -1
    const value = (task: ListTask): string | number => {
      switch (sort.key) {
        case 'task_number':
          return task.taskNumber
        case 'title':
          return task.title.toLowerCase()
        case 'status':
          return STATUS_ORDER.indexOf(task.status)
        case 'priority':
          return PRIORITIES.indexOf(task.priority)
        case 'assignee':
          return task.assignee?.full_name.toLowerCase() ?? '￿'
        case 'assigner':
          return task.assigner?.full_name.toLowerCase() ?? '￿'
        case 'due_date':
          // Undated sorts last in both directions rather than leading the
          // ascending list, which is never what someone sorting by due wants.
          return task.due_date ?? '￿'
        default:
          return 0
      }
    }

    return [...filtered].sort((a, b) => {
      const left = value(a)
      const right = value(b)
      if (left < right) return -1 * direction
      if (left > right) return 1 * direction
      return 0
    })
  }, [
    tasks,
    query,
    sort,
    projectKey,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    assignerFilter,
  ])

  const groups: ListGroup[] = useMemo(() => {
    if (groupMode === 'priority') {
      return PRIORITIES.map((priority) => ({
        key: priority,
        label: PRIORITY_LABEL[priority],
        color: PRIORITY_COLOR[priority],
        tasks: visible.filter((task) => task.priority === priority),
        addStatus: null,
        addColumnId: null,
      })).filter((group) => group.tasks.length > 0)
    }

    if (groupMode === 'assignee') {
      const seen = new Map<string, ListGroup>()
      for (const task of visible) {
        const key = task.assignee?.id ?? 'unassigned'
        if (!seen.has(key)) {
          seen.set(key, {
            key,
            label: (task.assignee?.full_name ?? 'Unassigned').toUpperCase(),
            color: task.assignee ? 'hsl(var(--primary))' : 'hsl(var(--subtle))',
            tasks: [],
            addStatus: null,
            addColumnId: null,
          })
        }
        seen.get(key)!.tasks.push(task)
      }
      return [...seen.values()]
    }

    return STATUS_ORDER.map((status) => ({
      key: status,
      label: STATUS_LABEL[status],
      color: STATUS_COLOR[status],
      tasks: visible.filter((task) => task.status === status),
      addStatus: status,
      addColumnId: statusColumns[status] ?? null,
    })).filter((group) => group.tasks.length > 0 || group.addColumnId !== null)
  }, [visible, groupMode, statusColumns])

  const statusOptions: FilterOption[] = STATUS_ORDER.map((status) => ({
    value: status,
    label: STATUS_LABEL[status],
    color: STATUS_COLOR[status],
  }))
  const priorityOptions: FilterOption[] = PRIORITIES.map((priority) => ({
    value: priority,
    label: PRIORITY_LABEL[priority],
    color: PRIORITY_COLOR[priority],
  }))
  const peopleOptions: FilterOption[] = people.map((person) => ({
    value: person.id,
    label: person.full_name,
  }))

  function clearFilters() {
    const params = new URLSearchParams(searchParams.toString())
    for (const key of ['status', 'priority', 'assignee', 'assigner']) params.delete(key)
    const search = params.toString()
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false })
    setQuery('')
  }

  function toggleSort(key: string) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, order: 'asc' }
      return current.order === 'asc' ? { key, order: 'desc' } : null
    })
  }

  return (
    <>
      <div className="border-border flex shrink-0 items-center gap-2 border-b px-5 py-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="border-input bg-card placeholder:text-faint w-[210px] rounded-[7px] border px-2.5 py-1.5 text-nav outline-none focus-visible:border-ring"
        />

        <FilterChip param="status" label="Status" options={statusOptions} />
        <FilterChip param="priority" label="Priority" options={priorityOptions} />
        <FilterChip param="assignee" label="Assignee" options={peopleOptions} />
        <FilterChip param="assigner" label="Assigned by" options={peopleOptions} />

        {anyFilter || query ? (
          <button
            type="button"
            onClick={clearFilters}
            className="text-subtle hover:text-foreground text-micro transition-colors"
          >
            Clear
          </button>
        ) : null}

        <span className="text-subtle ms-auto font-mono text-id uppercase tabular-nums">
          {sort ? `Sort: ${sort.key.replace('_', ' ')} ${sort.order === 'desc' ? '↓' : '↑'}` : 'Sort: none'}
        </span>
      </div>

      <div className="border-border flex shrink-0 items-center gap-2 border-b px-5 py-2">
        <SegmentedGroup aria-label="Group tasks by">
          {(['status', 'assignee', 'priority'] as GroupMode[]).map((mode) => (
            <SegmentedItem
              key={mode}
              size="sm"
              active={groupMode === mode}
              onClick={() => setGroupMode(mode)}
            >
              Group: {mode}
            </SegmentedItem>
          ))}
        </SegmentedGroup>

        <span className="text-faint ms-auto font-mono text-col uppercase tabular-nums">
          {anyFilter || query
            ? `${visible.length} of ${tasks.length} tasks`
            : `${tasks.length} tasks`}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className={cn('text-subtle px-5 py-[22px] text-ui')}>No tasks match these filters.</p>
      ) : (
        <TaskListGrid
          scope={scope}
          projectKey={projectKey}
          groups={groups}
          people={people}
          today={today}
          base={base}
          canEdit={canEdit}
          canDelete={canDelete}
          sortKey={sort?.key ?? ''}
          sortOrder={sort?.order ?? 'asc'}
          onSort={toggleSort}
        />
      )}
    </>
  )
}
