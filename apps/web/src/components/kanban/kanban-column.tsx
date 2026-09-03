'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@pm/ui'
import { KanbanCard } from './kanban-card'
import { KanbanQuickAdd } from './kanban-quick-add'
import type { KanbanCardData, KanbanColumnData, KanbanScope } from './types'

export function KanbanColumn({
  column,
  cards,
  scope,
  today,
  canCreate,
}: {
  column: KanbanColumnData
  cards: KanbanCardData[]
  scope: KanbanScope
  today: string
  canCreate: boolean
}) {
  // The column itself is a drop target so an empty column can still receive a card.
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', column },
  })

  const atLimit = column.wip_limit !== null && cards.length >= column.wip_limit
  const overLimit = column.wip_limit !== null && cards.length > column.wip_limit

  return (
    <section
      className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/50"
      aria-label={`${column.name} column`}
    >
      <header className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: column.color ?? 'hsl(var(--muted-foreground))' }}
            aria-hidden
          />
          <h2 className="truncate text-sm font-medium">{column.name}</h2>
          <span className="tabular-nums text-xs text-muted-foreground">{cards.length}</span>
        </div>

        {column.wip_limit !== null ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
              overLimit
                ? 'bg-destructive/15 font-medium text-destructive'
                : atLimit
                  ? 'bg-amber-500/15 font-medium text-amber-700 dark:text-amber-400'
                  : 'text-muted-foreground',
            )}
            title={`Work-in-progress limit: ${column.wip_limit}`}
          >
            {cards.length}/{column.wip_limit}
          </span>
        ) : null}
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2 transition-colors',
          isOver && 'rounded-md bg-primary/5 ring-2 ring-inset ring-primary/30',
        )}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-2">
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                today={today}
                href={`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/tasks/${card.id}`}
              />
            ))}
          </ul>
        </SortableContext>

        {canCreate ? <KanbanQuickAdd scope={scope} columnId={column.id} /> : null}
      </div>
    </section>
  )
}
