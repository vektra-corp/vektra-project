'use client'

import { SegmentedGroup, SegmentedItem, cn, toast } from '@pm/ui'
import { addDays } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, useTransition } from 'react'
import { rescheduleTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/timeline/actions'
import { PRIORITY_STRIPE } from '@/components/tasks/task-badges'
import {
  COLUMN_WIDTH,
  ROW_HEIGHT,
  chartRange,
  dayOffset,
  monthBands,
  parseDate,
  ticksFor,
  toDateString,
  type Zoom,
} from './scale'
import type { GanttDependency, GanttScope, GanttTask } from './types'

const LABEL_WIDTH = 240

interface Placed {
  task: GanttTask
  row: number
  from: number
  span: number
}

type DragMode = 'move' | 'start' | 'end'

/**
 * Gantt chart.
 *
 * A custom implementation rather than Frappe Gantt (§3 permits either): the
 * library ships its own stylesheet, which would fight the design tokens, and
 * the only behaviour actually needed is placement, dependency arrows and drag.
 *
 * Drag is optimistic — the bar follows the cursor and the write happens on
 * release (§23.2 rule 5). A rejected write snaps the bar back.
 */
export function GanttChart({
  scope,
  tasks,
  dependencies,
  today,
  canEdit,
}: {
  scope: GanttScope
  tasks: GanttTask[]
  dependencies: GanttDependency[]
  today: string
  canEdit: boolean
}) {
  const [zoom, setZoom] = useState<Zoom>('week')
  const [draft, setDraft] = useState<Record<string, { start: string; due: string }>>({})
  const [, startTransition] = useTransition()
  const router = useRouter()
  const dragRef = useRef<{
    taskId: string
    mode: DragMode
    originX: number
    start: string
    due: string
  } | null>(null)

  const columnWidth = COLUMN_WIDTH[zoom]

  // A task with only one date is drawn as a single day at that date; a task
  // with neither cannot be placed and is listed as unscheduled instead.
  const scheduled = useMemo(
    () =>
      tasks
        .map((task) => {
          const override = draft[task.id]
          const start = override?.start ?? task.startDate ?? task.dueDate
          const due = override?.due ?? task.dueDate ?? task.startDate
          return start && due ? { task, start, due } : null
        })
        .filter((entry): entry is { task: GanttTask; start: string; due: string } => entry !== null),
    [tasks, draft],
  )

  const unscheduled = tasks.filter((task) => !task.startDate && !task.dueDate)

  const { start: rangeStart, days } = useMemo(
    () => chartRange(scheduled.flatMap((entry) => [entry.start, entry.due]), today),
    [scheduled, today],
  )

  const placed: Placed[] = scheduled.map((entry, index) => {
    const from = dayOffset(rangeStart, entry.start)
    // Inclusive of the end day: a task due the day it starts is one day wide,
    // not zero.
    const span = Math.max(1, dayOffset(rangeStart, entry.due) - from + 1)
    return { task: entry.task, row: index, from, span }
  })

  const byId = new Map(placed.map((entry) => [entry.task.id, entry]))
  const width = days * columnWidth
  const height = Math.max(placed.length, 1) * ROW_HEIGHT
  const ticks = ticksFor(rangeStart, days, zoom)
  const bands = monthBands(rangeStart, days)
  const todayOffset = dayOffset(rangeStart, today)

  function beginDrag(event: React.PointerEvent, entry: Placed, mode: DragMode) {
    if (!canEdit) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture(event.pointerId)

    const current = draft[entry.task.id]
    dragRef.current = {
      taskId: entry.task.id,
      mode,
      originX: event.clientX,
      start: current?.start ?? entry.task.startDate ?? entry.task.dueDate!,
      due: current?.due ?? entry.task.dueDate ?? entry.task.startDate!,
    }
  }

  function onDragMove(event: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag) return

    const deltaDays = Math.round((event.clientX - drag.originX) / columnWidth)
    if (deltaDays === 0) return

    const start = parseDate(drag.start)
    const due = parseDate(drag.due)

    let nextStart = drag.start
    let nextDue = drag.due

    if (drag.mode === 'move') {
      nextStart = toDateString(addDays(start, deltaDays))
      nextDue = toDateString(addDays(due, deltaDays))
    } else if (drag.mode === 'start') {
      const candidate = addDays(start, deltaDays)
      // Never let an edge cross the other one; a negative-length bar is not a
      // state the database should ever be asked to hold.
      if (candidate <= due) nextStart = toDateString(candidate)
    } else {
      const candidate = addDays(due, deltaDays)
      if (candidate >= start) nextDue = toDateString(candidate)
    }

    setDraft((current) => ({ ...current, [drag.taskId]: { start: nextStart, due: nextDue } }))
  }

  function endDrag() {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return

    const next = draft[drag.taskId]
    if (!next || (next.start === drag.start && next.due === drag.due)) return

    startTransition(async () => {
      const result = await rescheduleTask(scope, drag.taskId, next.start, next.due)
      if (result.ok) {
        router.refresh()
      } else {
        // Snap back: the chart must not show a schedule the database refused.
        setDraft((current) => {
          const copy = { ...current }
          delete copy[drag.taskId]
          return copy
        })
        toast({ variant: 'destructive', title: 'Could not reschedule', description: result.message })
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-5">
        <SegmentedGroup aria-label="Timeline zoom">
          {(['day', 'week', 'month'] as Zoom[]).map((option) => (
            <SegmentedItem
              key={option}
              active={zoom === option}
              onClick={() => setZoom(option)}
              className="capitalize"
            >
              {option}
            </SegmentedItem>
          ))}
        </SegmentedGroup>
        <p className="label-meta text-faint">
          {placed.length} scheduled
          {unscheduled.length > 0 ? ` · ${unscheduled.length} undated` : ''}
        </p>
        {canEdit ? (
          <p className="label-meta ms-auto hidden text-faint lg:block">
            Drag a bar to move it, an edge to resize
          </p>
        ) : null}
      </div>

      <div className="mx-5 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <div className="scrollbar-slim overflow-x-auto">
          <div className="flex" style={{ minWidth: LABEL_WIDTH + width }}>
            {/* Task labels: a separate column so they stay legible while the
                chart scrolls horizontally. */}
            <div className="shrink-0 border-e border-border-subtle" style={{ width: LABEL_WIDTH }}>
              <div className="h-12 border-b border-border-subtle" />
              {placed.map((entry) => (
                <div
                  key={entry.task.id}
                  className="flex items-center gap-2 border-b border-border-subtle px-3"
                  style={{ height: ROW_HEIGHT }}
                >
                  <span className="label-meta shrink-0 text-faint">#{entry.task.taskNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-base">{entry.task.title}</span>
                </div>
              ))}
            </div>

            <div
              className="relative"
              style={{ width }}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <div className="h-12 border-b border-border-subtle">
                <div className="relative flex h-6 items-center border-b border-border-subtle">
                  {bands.map((band) => (
                    <div
                      key={`${band.label}-${band.offset}`}
                      className="label-meta absolute truncate ps-2 text-faint"
                      style={{ insetInlineStart: band.offset * columnWidth, width: band.span * columnWidth }}
                    >
                      {band.span * columnWidth > 60 ? band.label : ''}
                    </div>
                  ))}
                </div>
                <div className="relative h-6">
                  {ticks.map((tick) => (
                    <span
                      key={tick.offset}
                      className={cn(
                        'label-meta absolute top-1.5 ps-1',
                        tick.major ? 'text-muted-foreground' : 'text-faint',
                      )}
                      style={{ insetInlineStart: tick.offset * columnWidth }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="relative" style={{ height }}>
                {ticks.map((tick) => (
                  <div
                    key={tick.offset}
                    className={cn(
                      'absolute top-0 w-px',
                      tick.major ? 'bg-border' : 'bg-border-subtle/60',
                    )}
                    style={{ insetInlineStart: tick.offset * columnWidth, height }}
                    aria-hidden
                  />
                ))}

                {todayOffset >= 0 && todayOffset < days ? (
                  <div
                    className="absolute top-0 z-10 w-px bg-status-progress"
                    style={{ insetInlineStart: todayOffset * columnWidth, height }}
                    aria-hidden
                    title="Today"
                  />
                ) : null}

                <DependencyArrows
                  dependencies={dependencies}
                  byId={byId}
                  columnWidth={columnWidth}
                  width={width}
                  height={height}
                />

                {placed.map((entry) => (
                  <GanttBar
                    key={entry.task.id}
                    entry={entry}
                    columnWidth={columnWidth}
                    scope={scope}
                    canEdit={canEdit}
                    onDragStart={beginDrag}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {unscheduled.length > 0 ? (
        <div className="mx-5">
          <h2 className="label-meta pb-2 text-faint">Undated</h2>
          <ul className="flex flex-wrap gap-2">
            {unscheduled.map((task) => (
              <li
                key={task.id}
                className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-base text-muted-foreground"
              >
                <span className="label-meta pe-2 text-faint">#{task.taskNumber}</span>
                {task.title}
              </li>
            ))}
          </ul>
          <p className="pt-2 text-nav text-faint">
            Give these a start or due date to place them on the timeline.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function GanttBar({
  entry,
  columnWidth,
  scope,
  canEdit,
  onDragStart,
}: {
  entry: Placed
  columnWidth: number
  scope: GanttScope
  canEdit: boolean
  onDragStart: (event: React.PointerEvent, entry: Placed, mode: DragMode) => void
}) {
  const { task, row, from, span } = entry
  const done = task.status === 'done'
  const href = `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/tasks/${task.id}`

  if (task.isMilestone) {
    return (
      <a
        href={href}
        title={`${task.title} (milestone)`}
        className="absolute z-20 flex items-center justify-center"
        style={{
          insetInlineStart: from * columnWidth,
          top: row * ROW_HEIGHT,
          height: ROW_HEIGHT,
          width: columnWidth,
        }}
      >
        {/* A milestone is a moment, not a duration, so it is a marker not a bar. */}
        <span
          className="h-3 w-3 rotate-45 border border-background"
          style={{ backgroundColor: PRIORITY_STRIPE[task.priority] }}
          aria-hidden
        />
        <span className="sr-only">{task.title}</span>
      </a>
    )
  }

  return (
    <div
      className="absolute z-20 flex items-center"
      style={{
        insetInlineStart: from * columnWidth,
        top: row * ROW_HEIGHT,
        height: ROW_HEIGHT,
        width: span * columnWidth,
      }}
    >
      <div
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onPointerDown={(event) => onDragStart(event, entry, 'move')}
        className={cn(
          'group relative h-5 w-full rounded-[5px] border transition-colors',
          canEdit ? 'cursor-grab active:cursor-grabbing' : '',
          done ? 'border-transparent bg-surface-hover' : 'border-transparent',
        )}
        style={done ? undefined : { backgroundColor: `${PRIORITY_STRIPE[task.priority]}` }}
        title={`${task.title} · ${entry.task.startDate ?? '?'} → ${entry.task.dueDate ?? '?'}`}
      >
        <a
          href={href}
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute inset-0 flex items-center overflow-hidden px-1.5"
        >
          <span
            className={cn(
              'truncate text-[11px] font-medium',
              done ? 'text-muted-foreground line-through' : 'text-background',
            )}
          >
            {task.title}
          </span>
        </a>

        {canEdit ? (
          <>
            <span
              onPointerDown={(event) => onDragStart(event, entry, 'start')}
              className="absolute inset-y-0 start-0 w-1.5 cursor-ew-resize rounded-s-[5px] opacity-0 transition-opacity group-hover:bg-background/40 group-hover:opacity-100"
              aria-hidden
            />
            <span
              onPointerDown={(event) => onDragStart(event, entry, 'end')}
              className="absolute inset-y-0 end-0 w-1.5 cursor-ew-resize rounded-e-[5px] opacity-0 transition-opacity group-hover:bg-background/40 group-hover:opacity-100"
              aria-hidden
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Dependency arrows.
 *
 * Drawn as one SVG overlay rather than per-bar elements so the paths can cross
 * rows freely. Only edges where both ends are placed are drawn — an arrow to a
 * task with no dates would have nowhere to land.
 */
function DependencyArrows({
  dependencies,
  byId,
  columnWidth,
  width,
  height,
}: {
  dependencies: GanttDependency[]
  byId: Map<string, Placed>
  columnWidth: number
  width: number
  height: number
}) {
  const paths = dependencies
    .map((dependency) => {
      const from = byId.get(dependency.predecessorId)
      const to = byId.get(dependency.successorId)
      if (!from || !to) return null

      const x1 = (from.from + from.span) * columnWidth
      const y1 = from.row * ROW_HEIGHT + ROW_HEIGHT / 2
      const x2 = to.from * columnWidth
      const y2 = to.row * ROW_HEIGHT + ROW_HEIGHT / 2

      // Route around the bars: out from the predecessor, vertically to the
      // successor's row, then in. A straight line would cut through rows.
      const midX = x2 - 8 > x1 + 8 ? (x1 + x2) / 2 : x1 + 12
      return {
        key: `${dependency.predecessorId}-${dependency.successorId}`,
        d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`,
      }
    })
    .filter((path): path is { key: string; d: string } => path !== null)

  if (paths.length === 0) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10"
      width={width}
      height={height}
      aria-hidden
    >
      <defs>
        <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 z" fill="hsl(var(--faint))" />
        </marker>
      </defs>
      {paths.map((path) => (
        <path
          key={path.key}
          d={path.d}
          fill="none"
          stroke="hsl(var(--faint))"
          strokeWidth="1.5"
          markerEnd="url(#gantt-arrow)"
        />
      ))}
    </svg>
  )
}
