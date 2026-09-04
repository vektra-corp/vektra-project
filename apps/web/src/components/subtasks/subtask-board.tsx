'use client'

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { positionBetween , initials } from '@pm/shared/utils'
import { Alert, AlertDescription, Avatar, AvatarFallback, AvatarImage, cn } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { moveSubtask } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { STATUS_ACCENT } from '@/components/kanban/types'
import { DueDate, PRIORITY_STRIPE, TaskPriorityIcon } from '@/components/tasks/task-badges'
import { SubtaskQuickAdd } from './subtask-quick-add'

/**
 * Subtask-level Kanban (§20 Phase 2, §19.8, §17 `subtask_kanban`).
 *
 * Deliberately its own board rather than a reuse of `KanbanBoard`. The task
 * board carries saved views, four grouping modes, swimlanes, labels, task
 * numbers and dependency blocking — none of which a subtask has. Threading a
 * second entity through it would put branches into the more important
 * component; a subtask board is genuinely a smaller thing, so it is written as
 * one. What IS shared is the part where sharing pays: column-to-status coupling
 * and the WIP check, which both boards get from `moveCard` in @pm/db.
 *
 * Business rule 3 holds here as it does on the task board — dropping a card
 * writes `kanban_column_id` and `status` together, and there is no status-only
 * write path.
 */

export interface SubtaskCardData {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  position: number
  kanban_column_id: string | null
  estimated_hours: number | null
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
}

export interface SubtaskColumnData {
  id: string
  name: string
  color: string | null
  position: number
  wip_limit: number | null
  status: string
}

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

function Card({
  card,
  today,
  isOverlay = false,
}: {
  card: SubtaskCardData
  today: string
  isOverlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card },
  })

  const closed = card.status === 'done' || card.status === 'cancelled'

  return (
    <li
      ref={isOverlay ? undefined : setNodeRef}
      style={isOverlay ? undefined : { transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group border-border-subtle bg-surface-raised relative overflow-hidden rounded-md border ps-2.5 shadow-card',
        isDragging && !isOverlay && 'opacity-40',
        isOverlay && 'rotate-1 shadow-lg',
      )}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-[3px]"
        style={{ backgroundColor: PRIORITY_STRIPE[card.priority as keyof typeof PRIORITY_STRIPE] }}
      />

      <div className="px-2.5 py-2">
        <p className={cn('text-[13px] leading-snug', closed && 'text-muted-foreground line-through')}>
          {card.title}
        </p>

        <div className="flex items-center gap-2 pt-2">
          <TaskPriorityIcon priority={card.priority as never} />
          <DueDate dueDate={card.due_date} today={today} isClosed={closed} />

          {card.assignee ? (
            <Avatar className="ms-auto h-5 w-5">
              {card.assignee.avatar_url ? (
                <AvatarImage src={card.assignee.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="text-[9px]">
                {initials(card.assignee.full_name)}
              </AvatarFallback>
            </Avatar>
          ) : null}
        </div>
      </div>
    </li>
  )
}

function Column({
  column,
  cards,
  today,
  taskId,
  scope,
  canCreate,
}: {
  column: SubtaskColumnData
  cards: SubtaskCardData[]
  today: string
  taskId: string
  scope: Scope
  canCreate: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', column },
  })

  const atLimit = column.wip_limit !== null && cards.length >= column.wip_limit
  const overLimit = column.wip_limit !== null && cards.length > column.wip_limit
  const accent = column.color ?? STATUS_ACCENT[column.status as keyof typeof STATUS_ACCENT]

  return (
    <section className="flex w-[248px] shrink-0 flex-col" aria-label={`${column.name} column`}>
      <header className="flex h-8 items-center gap-2 px-1">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <h3 className="label-meta text-muted-foreground truncate">{column.name}</h3>
        <span className="text-faint font-mono text-[10px] tabular-nums">{cards.length}</span>
        {column.wip_limit !== null ? (
          <span
            className={cn(
              'label-meta ms-auto tabular-nums',
              overLimit ? 'text-destructive' : atLimit ? 'text-warning' : 'text-faint',
            )}
            title={`Work-in-progress limit: ${column.wip_limit}`}
          >
            WIP {cards.length}/{column.wip_limit}
          </span>
        ) : null}
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 rounded-lg p-1 transition-colors',
          isOver && 'bg-primary/5 ring-primary/25 ring-1 ring-inset',
        )}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <Card key={card.id} card={card} today={today} />
            ))}
          </ul>
        </SortableContext>

        {canCreate ? (
          <SubtaskQuickAdd scope={scope} taskId={taskId} columnId={column.id} />
        ) : null}
      </div>
    </section>
  )
}

export function SubtaskBoard({
  scope,
  taskId,
  columns,
  subtasks: initial,
  today,
  canEdit,
}: {
  scope: Scope
  taskId: string
  columns: SubtaskColumnData[]
  subtasks: SubtaskCardData[]
  today: string
  canEdit: boolean
}) {
  const [cards, setCards] = useState(initial)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  // 6px before a drag begins, so a click is not swallowed by the sensor.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const byColumn = useMemo(() => {
    const map = new Map<string, SubtaskCardData[]>()
    for (const column of columns) map.set(column.id, [])
    for (const card of cards) {
      if (card.kanban_column_id && map.has(card.kanban_column_id)) {
        map.get(card.kanban_column_id)!.push(card)
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [cards, columns])

  // A subtask whose column was deleted would otherwise disappear from the board
  // while still existing — surfaced rather than silently dropped.
  const orphaned = cards.filter(
    (card) => !card.kanban_column_id || !columns.some((c) => c.id === card.kanban_column_id),
  )

  const activeCard = activeId ? (cards.find((card) => card.id === activeId) ?? null) : null

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const card = cards.find((c) => c.id === String(active.id))
    if (!card) return

    const overData = over.data.current as
      | { type?: string; card?: SubtaskCardData }
      | undefined
    const targetColumnId =
      overData?.type === 'column' ? String(over.id) : overData?.card?.kanban_column_id

    if (!targetColumnId) return
    const targetColumn = columns.find((c) => c.id === targetColumnId)
    if (!targetColumn) return

    const destination = (byColumn.get(targetColumnId) ?? []).filter((c) => c.id !== card.id)
    const overIndex =
      overData?.type === 'card' ? destination.findIndex((c) => c.id === String(over.id)) : -1
    const insertAt = overIndex === -1 ? destination.length : overIndex

    if (card.kanban_column_id === targetColumnId) {
      const currentIndex = (byColumn.get(targetColumnId) ?? []).findIndex((c) => c.id === card.id)
      if (currentIndex === insertAt) return
    }

    const position = positionBetween(
      destination[insertAt - 1]?.position ?? null,
      destination[insertAt]?.position ?? null,
    )

    const previous = cards

    // Optimistic (§23.2 rule 5): paint the move, reconcile after.
    setCards((current) =>
      current.map((c) =>
        c.id === card.id
          ? { ...c, kanban_column_id: targetColumnId, status: targetColumn.status, position }
          : c,
      ),
    )

    startTransition(async () => {
      const result = await moveSubtask(scope, {
        subtask_id: card.id,
        target_column_id: targetColumnId,
        position,
      })

      if (!result.ok) {
        // Revert to exactly what was on screen before, so a rejected WIP move
        // does not leave the card in a column the server refused.
        setCards(previous)
        setError(result.message)
        return
      }

      setError(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {orphaned.length > 0 ? (
        <Alert>
          <AlertCircle aria-hidden />
          <AlertDescription>
            {orphaned.length} subtask{orphaned.length === 1 ? '' : 's'} sit outside every
            column, usually because a column was deleted. They still exist — reopen this
            board to place them.
          </AlertDescription>
        </Alert>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) => {
          setActiveId(String(event.active.id))
          setError(null)
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="scrollbar-slim flex gap-3 overflow-x-auto pb-2">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={byColumn.get(column.id) ?? []}
              today={today}
              taskId={taskId}
              scope={scope}
              canCreate={canEdit}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? (
            <ul>
              <Card card={activeCard} today={today} isOverlay />
            </ul>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
