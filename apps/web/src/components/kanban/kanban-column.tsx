'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { KanbanViewConfig } from '@pm/shared/constants'
import { cn } from '@pm/ui'
import { ChevronsLeftRight } from 'lucide-react'
import { useState } from 'react'
import { KanbanCard } from './kanban-card'
import { KanbanQuickAdd } from './kanban-quick-add'
import {
  STATUS_ACCENT,
  type KanbanCardData,
  type KanbanColumnData,
  type KanbanScope,
} from './types'

export function KanbanColumn({
  column,
  cards,
  scope,
  today,
  view,
  canCreate,
  canQuickAdd,
}: {
  column: KanbanColumnData
  cards: KanbanCardData[]
  scope: KanbanScope
  today: string
  view: Pick<KanbanViewConfig, 'card_fields' | 'compact_mode' | 'show_column_count'>
  canCreate: boolean
  /** Quick-add only makes sense for a column a new task can actually land in. */
  canQuickAdd: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)

  // The column itself is a drop target so an empty column can still receive a card.
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', column },
  })

  const atLimit = column.wip_limit !== null && cards.length >= column.wip_limit
  const overLimit = column.wip_limit !== null && cards.length > column.wip_limit
  const points = cards.reduce((sum, card) => sum + (card.estimated_hours ?? 0), 0)
  const accent = column.color ?? STATUS_ACCENT[column.status]

  if (collapsed) {
    return (
      <section
        className="bg-background flex w-11 shrink-0 flex-col items-center gap-3 py-3.5"
        aria-label={`${column.name} column, collapsed`}
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="text-faint hover:text-foreground transition-colors"
          aria-label={`Expand ${column.name}`}
        >
          <ChevronsLeftRight className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        {/* Vertical label keeps a collapsed column readable without a tooltip. */}
        <span className="label-meta-lg text-muted-foreground [writing-mode:vertical-rl]">
          {column.name}
        </span>
        <span className="text-subtle font-mono text-col tabular-nums">{cards.length}</span>
      </section>
    )
  }

  return (
    <section
      className="bg-background flex min-h-0 w-[272px] shrink-0 flex-col"
      aria-label={`${column.name} column`}
    >
      <header className="flex items-center gap-2 px-3 pb-2.5 pt-3">
        <span
          className="h-[5px] w-[5px] shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <h2 className="label-meta-lg text-muted-foreground truncate">{column.name}</h2>
        <span className="text-subtle font-mono text-col tabular-nums">{cards.length}</span>

        <span className="ms-auto flex items-center gap-2">
          {column.wip_limit !== null ? (
            <span
              className={cn(
                'font-mono text-meta tabular-nums',
                overLimit ? 'text-destructive' : atLimit ? 'text-warning' : 'text-subtle',
              )}
              title={`Work-in-progress limit: ${column.wip_limit}`}
            >
              WIP {cards.length}/{column.wip_limit}
            </span>
          ) : (
            <span className="text-subtle font-mono text-meta tabular-nums">{points} PTS</span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-subtle hover:text-foreground transition-colors"
            aria-label={`Collapse ${column.name}`}
          >
            <ChevronsLeftRight className="h-3 w-3" aria-hidden />
          </button>
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={cn(
          'scrollbar-slim flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-2.5 pb-3 transition-colors',
          isOver && 'bg-primary/5 ring-primary/25 ring-1 ring-inset',
        )}
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-[9px]">
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                scope={scope}
                today={today}
                view={view}
                href={`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/tasks/${card.id}`}
              />
            ))}
          </ul>
        </SortableContext>

        {canCreate && canQuickAdd ? (
          <KanbanQuickAdd scope={scope} columnId={column.id} />
        ) : null}
      </div>
    </section>
  )
}
