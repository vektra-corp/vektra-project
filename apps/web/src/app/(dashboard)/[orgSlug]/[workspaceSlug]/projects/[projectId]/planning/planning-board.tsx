'use client'

import type { Priority } from '@pm/shared/constants'
import { Button, cn } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { TaskPriorityIcon } from '@/components/tasks/task-badges'
import { setTaskSprint } from './actions'

export interface PlanningItem {
  id: string
  title: string
  number: number
  priority: Priority
  points: number
  assigneeId: string | null
  assigneeName: string | null
  /** The sprint this item is committed to, or null while it is backlog. */
  sprintId: string | null
  /** The label standing in for the design's epic; null groups as "No epic". */
  groupId: string | null
  groupName: string
  groupColor: string | null
}

export interface PlanningSprint {
  id: string
  name: string
  startsOn: string
  endsOn: string
}

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/**
 * Backlog planning.
 *
 * Ticking items on the left builds a candidate list on the right; committing
 * writes them all in one action rather than one request per tick, so a
 * half-applied sprint is not a state the board can end up in.
 */
export function PlanningBoard({
  scope,
  prefix,
  backlog,
  committed,
  sprint,
  capacity,
  canEdit,
}: {
  scope: Scope
  prefix: string
  backlog: PlanningItem[]
  committed: PlanningItem[]
  sprint: PlanningSprint | null
  capacity: number
  canEdit: boolean
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; color: string | null; items: PlanningItem[] }>()
    for (const item of backlog) {
      const key = item.groupId ?? 'none'
      const entry = map.get(key) ?? { name: item.groupName, color: item.groupColor, items: [] }
      entry.items.push(item)
      map.set(key, entry)
    }
    return [...map.entries()]
  }, [backlog])

  const pickedItems = backlog.filter((item) => picked.has(item.id))
  const committedPoints = committed.reduce((sum, item) => sum + item.points, 0)
  const pickedPoints = pickedItems.reduce((sum, item) => sum + item.points, 0)
  const total = committedPoints + pickedPoints

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function run(taskIds: string[], sprintId: string | null) {
    setError(null)
    startTransition(async () => {
      const result = await setTaskSprint(scope, taskIds, sprintId)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setPicked(new Set())
      router.refresh()
    })
  }

  // Load per person across what is already committed plus what is ticked, so
  // the bars answer "if I commit this, who is overloaded" rather than only
  // describing the sprint as it stands.
  const load = new Map<string, { name: string; points: number }>()
  for (const item of [...committed, ...pickedItems]) {
    const key = item.assigneeId ?? 'unassigned'
    const entry = load.get(key) ?? { name: item.assigneeName ?? 'Unassigned', points: 0 }
    entry.points += item.points
    load.set(key, entry)
  }
  const loadRows = [...load.values()].sort((a, b) => b.points - a.points)

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="scrollbar-slim min-w-0 flex-1 overflow-y-auto px-5 py-4">
        {groups.length === 0 ? (
          <p className="text-faint py-16 text-center text-base">
            Nothing in the backlog — every task is already in a sprint.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {groups.map(([key, group]) => {
              const points = group.items.reduce((sum, item) => sum + item.points, 0)
              return (
                <li key={key}>
                  <div className="flex items-center gap-2.5 pb-2">
                    <span
                      className="h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{
                        backgroundColor: group.color ?? 'hsl(var(--status-backlog))',
                      }}
                      aria-hidden
                    />
                    <h2 className="text-base font-semibold">{group.name}</h2>
                    <span className="label-meta-lg text-subtle">
                      {group.items.length} items · {points} pts
                    </span>
                  </div>

                  <ul className="flex flex-col">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="border-border hover:bg-surface-hover/40 flex items-center gap-3 border-b py-2.5 transition-colors"
                      >
                        <label className="flex cursor-pointer items-center">
                          <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={picked.has(item.id)}
                            disabled={!canEdit || pending || !sprint}
                            onChange={() => toggle(item.id)}
                          />
                          <span
                            aria-hidden
                            className={cn(
                              'grid h-[18px] w-[18px] place-items-center rounded-[5px] border transition-colors',
                              picked.has(item.id)
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input text-transparent',
                              'peer-focus-visible:ring-ring/60 peer-focus-visible:ring-2',
                            )}
                          >
                            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                              <path
                                d="m2.5 6.2 2.3 2.3 4.7-5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="sr-only">Select {item.title}</span>
                        </label>

                        <span className="label-id text-faint w-16 shrink-0">
                          {prefix}-{item.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-base">{item.title}</span>
                        <TaskPriorityIcon priority={item.priority} showLabel />
                        <span className="label-id text-faint w-14 shrink-0 text-end">
                          {item.points} PTS
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <aside className="border-border scrollbar-slim w-full shrink-0 overflow-y-auto border-s px-5 py-4 lg:w-[340px]">
        {sprint ? (
          <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold">{sprint.name}</h2>
              <span className="label-meta text-subtle">starts {sprint.startsOn}</span>
            </div>
            <p className="text-[26px] font-semibold leading-none tabular-nums">
              {total}
              <span className="text-faint ps-2 text-base font-normal">
                of {capacity} pts committed
              </span>
            </p>
            <span className="bg-chip block h-1 overflow-hidden rounded-sm">
              <span
                className={cn(
                  'block h-full rounded-sm',
                  total > capacity ? 'bg-destructive' : 'from-brand-from to-brand-to bg-gradient-to-r',
                )}
                style={{ width: `${Math.min(100, (total / capacity) * 100)}%` }}
              />
            </span>
            <p className="text-faint text-ui">
              Tick backlog items on the left, then commit them to the sprint.
            </p>
            {pickedItems.length > 0 && canEdit ? (
              <Button
                size="sm"
                loading={pending}
                onClick={() => run([...picked], sprint.id)}
                className="w-full"
              >
                Commit {pickedItems.length} to {sprint.name}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="border-border bg-card rounded-lg border p-4">
            <p className="text-faint text-ui">
              No sprint is open for this project yet. Create one to start committing work.
            </p>
          </div>
        )}

        {error ? <p className="text-destructive pt-3 text-ui">{error}</p> : null}

        <h3 className="label-meta text-subtle pb-2 pt-5">Committed</h3>
        {committed.length === 0 ? (
          <p className="border-border text-faint rounded-lg border border-dashed px-3 py-6 text-center text-ui">
            Select items on the left to commit
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {committed.map((item) => (
              <li
                key={item.id}
                className="border-border bg-card flex items-center gap-2 rounded-lg border px-3 py-2"
              >
                <span className="label-id text-faint shrink-0">
                  {prefix}-{item.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui">{item.title}</span>
                <span className="label-id text-faint">{item.points}</span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => run([item.id], null)}
                    disabled={pending}
                    className="text-subtle hover:text-destructive transition-colors"
                    aria-label={`Return ${item.title} to the backlog`}
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {loadRows.length > 0 ? (
          <>
            <h3 className="label-meta text-subtle pb-2 pt-5">Load by person</h3>
            <ul className="flex flex-col gap-2">
              {loadRows.map((row) => (
                <li key={row.name} className="flex items-center gap-2.5">
                  <span className="w-16 shrink-0 truncate text-ui">{row.name}</span>
                  <span className="bg-chip block h-1 flex-1 overflow-hidden rounded-sm">
                    <span
                      className={cn(
                        'block h-full rounded-sm',
                        row.points > capacity ? 'bg-destructive' : 'bg-primary',
                      )}
                      style={{ width: `${Math.min(100, (row.points / capacity) * 100)}%` }}
                    />
                  </span>
                  <span className="label-id text-faint w-6 shrink-0 text-end">{row.points}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </aside>
    </div>
  )
}
