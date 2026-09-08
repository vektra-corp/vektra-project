'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { KanbanViewConfig } from '@pm/shared/constants'
import { initials } from '@pm/shared/utils'
import { cn } from '@pm/ui'
import { KanbanCard } from './kanban-card'
import { KanbanQuickAdd } from './kanban-quick-add'
import { swimlanesFor } from './swimlanes'
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
  isDragging,
  dropIndex,
  landedId,
  collapsed,
  onToggleCollapse,
}: {
  column: KanbanColumnData
  cards: KanbanCardData[]
  scope: KanbanScope
  today: string
  view: Pick<
    KanbanViewConfig,
    'card_fields' | 'compact_mode' | 'card_color_by' | 'show_column_count' | 'swimlane_by'
  >
  canCreate: boolean
  /** Quick-add only makes sense for a column a new task can actually land in. */
  canQuickAdd: boolean
  /** True while any card on the board is being dragged. */
  isDragging: boolean
  /** Where a drop would land in THIS column, or null when it would not. */
  dropIndex: number | null
  /** The card that just landed, so it plays the arrival animation once. */
  landedId: string | null
  collapsed: boolean
  onToggleCollapse: (collapsed: boolean) => void
}) {
  // The column itself is a drop target so an empty column can still receive a card.
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', column },
  })

  const atLimit = column.wip_limit !== null && cards.length >= column.wip_limit
  const overLimit = column.wip_limit !== null && cards.length > column.wip_limit
  const points = cards.reduce((sum, card) => sum + (card.estimated_hours ?? 0), 0)
  const accent = column.color ?? STATUS_ACCENT[column.status]
  const lanes = swimlanesFor(cards, view.swimlane_by)
  // Running start index of each lane within the column, so a column-wide drop
  // index can be resolved to the lane it falls in.
  const laneOffsets = new Map<string, number>()
  let offset = 0
  for (const lane of lanes) {
    laneOffsets.set(lane.key, offset)
    offset += lane.cards.length
  }

  if (collapsed) {
    return (
      <section
        className="bg-background flex min-h-0 flex-col"
        aria-label={`${column.name} column, collapsed`}
      >
        <button
          type="button"
          onClick={() => onToggleCollapse(false)}
          className="text-muted-foreground hover:text-foreground flex flex-1 flex-col items-center gap-2.5 py-3.5 transition-colors"
          aria-label={`Expand ${column.name}`}
        >
          <span className="text-subtle font-mono text-col tabular-nums">{cards.length}</span>
          {/* Vertical label keeps a collapsed column readable without a tooltip. */}
          <span className="label-meta-lg [writing-mode:vertical-rl]">{column.name}</span>
        </button>
      </section>
    )
  }

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col transition-[background,box-shadow]',
        isOver ? 'bg-surface-raised ring-primary ring-[1.5px] ring-inset' : 'bg-background',
        !isOver && overLimit && 'ring-destructive ring-1 ring-inset',
      )}
      aria-label={`${column.name} column`}
    >
      <header className="flex items-center gap-2 px-3 pb-2.5 pt-3">
        {/* Grouping by assignee heads the column with the person, not a dot. */}
        {column.avatarLabel ? (
          <span className="bg-chip text-muted-foreground grid h-5 w-5 shrink-0 place-items-center rounded-full text-meta font-semibold uppercase">
            {initials(column.avatarLabel)}
          </span>
        ) : (
          <span
            className="h-[5px] w-[5px] shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
        )}
        <h2 className="label-meta-lg text-muted-foreground truncate">{column.name}</h2>
        {view.show_column_count ? (
          <span className="text-subtle font-mono text-col tabular-nums">{cards.length}</span>
        ) : null}

        <span
          className={cn(
            'ms-auto whitespace-nowrap font-mono text-meta tabular-nums',
            overLimit ? 'text-destructive' : atLimit ? 'text-warning' : 'text-subtle',
          )}
          title={
            column.wip_limit !== null
              ? `Work-in-progress limit: ${column.wip_limit}`
              : 'Estimated points in this column'
          }
        >
          {column.wip_limit !== null
            ? `WIP ${cards.length}/${column.wip_limit}`
            : `${points} PTS`}
        </span>
        <button
          type="button"
          onClick={() => onToggleCollapse(true)}
          className="text-subtle hover:text-foreground font-glyph shrink-0 text-col leading-none transition-colors"
          aria-label={`Collapse ${column.name}`}
        >
          <span aria-hidden>‹›</span>
        </button>
      </header>

      <div
        ref={setNodeRef}
        className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto px-2.5 pb-3"
      >
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {lanes.map((lane) => {
            // `dropIndex` counts across the whole column; a lane needs it in its
            // own terms, and only when the insertion point falls inside it.
            const laneStart = laneOffsets.get(lane.key) ?? 0
            const laneDropIndex =
              dropIndex !== null &&
              dropIndex >= laneStart &&
              dropIndex < laneStart + lane.cards.length
                ? dropIndex - laneStart
                : null
            // Only the LAST lane shows an end slot. Otherwise an index that
            // falls on a lane boundary would be drawn twice: once as this
            // lane's trailing slot and again as the next lane's leading line.
            const dropsAtLaneEnd =
              dropIndex !== null &&
              lane.key === lanes[lanes.length - 1]?.key &&
              dropIndex >= laneStart + lane.cards.length

            return (
            <div key={lane.key} className="flex flex-col gap-[7px]">
              {lane.label ? (
                <div className="flex items-center gap-[7px] px-0.5 pb-px pt-0.5">
                  <span
                    aria-hidden
                    className="h-1 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: lane.color }}
                  />
                  <span className="text-subtle font-mono text-[8.5px] uppercase leading-none tracking-[0.12em]">
                    {lane.label}
                  </span>
                  <span aria-hidden className="bg-border block h-px flex-1" />
                </div>
              ) : null}

              <ul className="flex flex-col gap-[9px]">
                {lane.cards.map((card, index) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    scope={scope}
                    today={today}
                    view={view}
                    // The line sits on top of the card that would be pushed
                    // down, which is where the dragged card is about to go.
                    showDropLine={laneDropIndex === index}
                    justLanded={landedId === card.id}
                    href={`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/tasks/${card.publicId}`}
                  />
                ))}
              </ul>

              {/* The slot the card drops into at the foot of a lane. */}
              {dropsAtLaneEnd ? (
                <span
                  aria-hidden
                  className="border-primary bg-primary/[0.07] animate-drop-slot block h-[38px] rounded-[9px] border border-dashed"
                />
              ) : null}
            </div>
            )
          })}
        </SortableContext>

        {isDragging ? null : canCreate && canQuickAdd ? (
          <KanbanQuickAdd scope={scope} columnId={column.id} />
        ) : null}
      </div>
    </section>
  )
}
