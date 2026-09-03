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
import { positionBetween } from '@pm/shared/utils'
import { Alert, AlertDescription } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { moveTask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
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
  canCreate,
}: {
  columns: KanbanColumnData[]
  cards: KanbanCardData[]
  scope: KanbanScope
  today: string
  canCreate: boolean
}) {
  const [cards, setCards] = useState(initialCards)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      if (card.kanban_column_id && map.has(card.kanban_column_id)) {
        map.get(card.kanban_column_id)!.push(card)
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [cards, columns])

  const activeCard = activeId ? cards.find((card) => card.id === activeId) ?? null : null

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
    const targetColumnId =
      overData?.type === 'column' ? String(over.id) : overData?.card?.kanban_column_id

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
    if (card.kanban_column_id === targetColumnId) {
      const currentIndex = (byColumn.get(targetColumnId) ?? []).findIndex((c) => c.id === card.id)
      if (currentIndex === insertAt) return
    }

    const before = destination[insertAt - 1]?.position ?? null
    const after = destination[insertAt]?.position ?? null
    const position = positionBetween(before, after)

    const previous = cards
    setCards((current) =>
      current.map((c) =>
        c.id === card.id
          ? { ...c, kanban_column_id: targetColumnId, status: targetColumn.status, position }
          : c,
      ),
    )

    startTransition(async () => {
      const result = await moveTask(scope, {
        task_id: card.id,
        target_column_id: targetColumnId,
        position,
      })

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

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
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
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              cards={byColumn.get(column.id) ?? []}
              scope={scope}
              today={today}
              canCreate={canCreate}
            />
          ))}
        </div>

        {/* Follows the cursor so the card stays legible over other columns. */}
        <DragOverlay>
          {activeCard ? (
            <ul className="w-72">
              <KanbanCard card={activeCard} href="#" today={today} isOverlay />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
