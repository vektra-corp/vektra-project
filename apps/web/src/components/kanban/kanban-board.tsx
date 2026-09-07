'use client'

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { KanbanViewConfig } from '@pm/shared/constants'
import { positionBetween } from '@pm/shared/utils'
import { Alert, AlertDescription } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { moveTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { applyViewDrop } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/view-actions'
import { KanbanCard } from './kanban-card'
import { KanbanColumn } from './kanban-column'
import type { KanbanCardData, KanbanColumnData, KanbanScope } from './types'

/**
 * Kanban board.
 *
 * Dropping a card updates the UI immediately and syncs afterwards (§23.2 rule 5).
 * If the server rejects the move — most often a WIP limit — the previous layout
 * is restored and the reason is shown, so the board never displays a state the
 * database refused.
 */
export function KanbanBoard({
  columns,
  cards: initialCards,
  scope,
  today,
  view,
  canCreate,
}: {
  columns: KanbanColumnData[]
  cards: KanbanCardData[]
  scope: KanbanScope
  today: string
  view: KanbanViewConfig
  canCreate: boolean
}) {
  // Only status grouping maps onto real kanban_columns rows, so it is the only
  // mode where a card carries a persisted column id and a new card has a column
  // to be created in (§19.8).
  const isStatusGrouped = view.group_by === 'status'
  const [cards, setCards] = useState(initialCards)
  // Re-seed from the server when a refresh brings new data.
  //
  // `useState(initialCards)` captures only the FIRST value: after
  // `router.refresh()` the server component re-renders and passes a new array,
  // but the state keeps the old one. The visible symptom was that a task added
  // through quick-add did not appear until the page was reloaded — it existed
  // in the database the whole time, which is what made it hard to notice.
  //
  // Adjusting state during render rather than in an effect is React's own
  // recommendation for this: it re-renders before the browser paints, so there
  // is no flash of the stale list.
  const [seed, setSeed] = useState(initialCards)
  if (seed !== initialCards) {
    setSeed(initialCards)
    setCards(initialCards)
  }

  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Collapsed columns live here rather than in each column, because the board's
  // grid template has to know which tracks are 46px and which share the rest.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [, startTransition] = useTransition()
  const router = useRouter()

  // A pointer must travel 6px before a drag starts, so a click on the card's
  // link is not swallowed by the drag sensor.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const byColumn = useMemo(() => {
    const map = new Map<string, KanbanCardData[]>()
    for (const column of columns) map.set(column.id, [])

    for (const card of cards) {
      const key = isStatusGrouped
        ? card.kanban_column_id
        : view.group_by === 'priority'
          ? `priority:${card.priority}`
          : view.group_by === 'assignee'
            ? `assignee:${card.assignee?.id ?? 'none'}`
            : `label:${card.labels[0]?.id ?? 'none'}`

      if (key && map.has(key)) map.get(key)!.push(card)
    }

    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [cards, columns, isStatusGrouped, view.group_by])

  const activeCard = activeId ? (cards.find((card) => card.id === activeId) ?? null) : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    setError(null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const card = cards.find((c) => c.id === String(active.id))
    if (!card) return

    // Dropping onto a column header targets the column; dropping onto a card
    // targets that card's column and takes its slot.
    const overData = over.data.current as { type?: string; card?: KanbanCardData } | undefined
    const overCard = overData?.card
    const targetColumnId =
      overData?.type === 'column'
        ? String(over.id)
        : overCard
          ? columnKeyOf(overCard)
          : undefined

    if (!targetColumnId) return

    const targetColumn = columns.find((c) => c.id === targetColumnId)
    if (!targetColumn) return

    const destination = (byColumn.get(targetColumnId) ?? []).filter((c) => c.id !== card.id)
    const overIndex =
      overData?.type === 'card'
        ? destination.findIndex((c) => c.id === String(over.id))
        : destination.length

    const insertAt = overIndex === -1 ? destination.length : overIndex

    // Nothing actually changed.
    if (columnKeyOf(card) === targetColumnId) {
      const currentIndex = (byColumn.get(targetColumnId) ?? []).findIndex((c) => c.id === card.id)
      if (currentIndex === insertAt) return
      // Reordering within a derived column has nothing to persist: position is
      // only meaningful under status grouping.
      if (!isStatusGrouped) return
    }

    const before = destination[insertAt - 1]?.position ?? null
    const after = destination[insertAt]?.position ?? null
    const position = positionBetween(before, after)

    const previous = cards

    // Optimistic update (§23.2 rule 5): paint the move now, reconcile after.
    setCards((current) =>
      current.map((c) => {
        if (c.id !== card.id) return c
        if (isStatusGrouped) {
          return { ...c, kanban_column_id: targetColumnId, status: targetColumn.status, position }
        }
        if (view.group_by === 'priority') {
          return { ...c, priority: (targetColumn.value ?? c.priority) as KanbanCardData['priority'] }
        }
        if (view.group_by === 'assignee') {
          const person =
            targetColumn.value === null
              ? null
              : (cards.find((other) => other.assignee?.id === targetColumn.value)?.assignee ?? null)
          return { ...c, assignee: person }
        }
        return c
      }),
    )

    startTransition(async () => {
      // Status grouping goes through moveTask, which owns the WIP check and
      // keeps column and status in step (§18 rule 3). The other groupings edit
      // the grouped attribute instead.
      const result = isStatusGrouped
        ? await moveTask(scope, {
            task_id: card.id,
            target_column_id: targetColumnId,
            position,
          })
        : view.group_by === 'priority'
          ? await applyViewDrop(scope, card.id, { priority: targetColumn.value ?? 'medium' })
          : view.group_by === 'assignee'
            ? await applyViewDrop(scope, card.id, { assignee_id: targetColumn.value ?? null })
            : null

      // Grouping by label has no single attribute a drop could set — a task can
      // carry several — so those columns are read-only rather than lying.
      if (!result) {
        setCards(previous)
        setError('Cards cannot be moved while grouped by label.')
        return
      }

      if (!result.ok) {
        setCards(previous)
        setError(
          result.code === 'WIP_LIMIT'
            ? `"${targetColumn.name}" has reached its work-in-progress limit.`
            : result.message,
        )
        return
      }
      router.refresh()
    })
  }

  /** Which column a card currently sits in, under the active grouping. */
  function columnKeyOf(card: KanbanCardData): string {
    if (isStatusGrouped) return card.kanban_column_id ?? ''
    if (view.group_by === 'priority') return `priority:${card.priority}`
    if (view.group_by === 'assignee') return `assignee:${card.assignee?.id ?? 'none'}`
    return `label:${card.labels[0]?.id ?? 'none'}`
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <Alert variant="destructive" className="mx-5 mb-3">
          <AlertCircle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/*
          * The design separates columns with a 1px rule that runs the full
          * height of the board. That is this gap: a 1px grid gutter over a
          * line-coloured ground, with each column painting its own background
          * back over the cell. A border on the column itself could not do it —
          * it would stop at the last card rather than reaching the floor.
          *
          * Columns SHARE the width rather than each taking a fixed one: an open
          * column is `minmax(0,1fr)`, a collapsed one the design's 46px rail.
          * `minmax(0,...)` rather than plain `1fr` so a long task title wraps
          * instead of forcing the track wider than its share.
          */}
        <div
          className="bg-border grid min-h-0 flex-1 gap-px"
          style={{
            gridTemplateColumns: columns
              .map((column) => (collapsed[column.id] ? '46px' : 'minmax(0,1fr)'))
              .join(' '),
          }}
        >
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              cards={byColumn.get(column.id) ?? []}
              scope={scope}
              today={today}
              view={view}
              canCreate={canCreate}
              canQuickAdd={isStatusGrouped}
              collapsed={Boolean(collapsed[column.id])}
              onToggleCollapse={(next) =>
                setCollapsed((current) => ({ ...current, [column.id]: next }))
              }
            />
          ))}
        </div>

        {/* Follows the cursor so the card stays legible over other columns. */}
        <DragOverlay>
          {activeCard ? (
            <ul className="w-[268px]">
              <KanbanCard card={activeCard} href="#" today={today} view={view} isOverlay />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
