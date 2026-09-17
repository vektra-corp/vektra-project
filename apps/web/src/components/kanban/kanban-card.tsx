'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isCardFieldVisible, type KanbanViewConfig } from '@pm/shared/constants'
import { initials } from '@pm/shared/utils'
import { cn } from '@pm/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  setTaskDone,
  toggleSubtask,
} from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { DueDate, PRIORITY_STRIPE, priorityLabel } from '@/components/tasks/task-badges'
import type { KanbanCardData, KanbanScope } from './types'

/**
 * Which colour the card's left edge carries.
 *
 * The design paints the stripe as the card's own 3px left border rather than as
 * an overlaid bar, so it can never shift the content box, and "no colour"
 * degrades to the ordinary 1px hairline instead of leaving a gap.
 */
function stripeColor(
  card: KanbanCardData,
  colorBy: KanbanViewConfig['card_color_by'],
): string | null {
  if (colorBy === 'none') return null
  if (colorBy === 'label') return card.labels[0]?.color ?? 'hsl(var(--subtle))'
  if (colorBy === 'status') return `hsl(var(--status-${card.status === 'in_progress' ? 'progress' : card.status === 'in_review' ? 'review' : card.status === 'done' ? 'done' : 'backlog'}))`
  return PRIORITY_STRIPE[card.priority]
}

export function KanbanCard({
  card,
  href,
  today,
  scope,
  view,
  isOverlay = false,
  showDropLine = false,
  justLanded = false,
}: {
  card: KanbanCardData
  href: string
  today: string
  /** Absent in the drag overlay, where the completion toggle is not interactive. */
  scope?: KanbanScope
  /** Which fields this board's saved view shows (§19.8). */
  view: Pick<KanbanViewConfig, 'card_fields' | 'compact_mode' | 'card_color_by'>
  /** Rendered inside the drag overlay rather than in a column. */
  isOverlay?: boolean
  /** A dragged card would land immediately above this one. */
  showDropLine?: boolean
  /** This card just arrived from a drop, so it plays the landing animation. */
  justLanded?: boolean
}) {
  const shows = (field: Parameters<typeof isCardFieldVisible>[1]) => isCardFieldVisible(view, field)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card },
  })
  const [pending, startTransition] = useTransition()
  // The checklist folds out of the card in place. It is per-card local state
  // rather than lifted: nothing outside the card reacts to it, and keeping it
  // here means opening one card cannot re-render the whole column.
  const [subtasksOpen, setSubtasksOpen] = useState(false)
  const router = useRouter()

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const done = card.status === 'done'
  const closed = done || card.status === 'cancelled'
  const points = card.estimated_hours
  const stripe = stripeColor(card, view.card_color_by)

  // The meta row is the card's compact mode switch: minimal hides it, and with
  // it the point count, leaving title and assignee only.
  const minimal = view.compact_mode
  const subtaskPct = card.subtask_total
    ? Math.round((card.subtask_done / card.subtask_total) * 100)
    : done
      ? 100
      : 0

  function toggleDone(next: boolean) {
    if (!scope) return
    startTransition(async () => {
      await setTaskDone(scope, card.id, next)
      router.refresh()
    })
  }

  function toggleSubtaskDone(subtaskId: string, next: boolean) {
    if (!scope) return
    startTransition(async () => {
      await toggleSubtask(scope, subtaskId, next)
      router.refresh()
    })
  }

  return (
    <li
      ref={setNodeRef}
      style={{
        ...style,
        borderInlineStartWidth: stripe ? '3px' : undefined,
        borderInlineStartColor: stripe ?? undefined,
      }}
      className={cn(
        'border-border bg-card group relative flex flex-col gap-2 rounded-[9px] border p-[11px] px-3 transition-[opacity,transform,border-color,box-shadow]',
        'hover:border-input cursor-grab active:cursor-grabbing',
        // The original stays in place as a placeholder while the overlay follows
        // the cursor; hiding it entirely would make the list jump.
        isDragging && !isOverlay && 'scale-[0.975] opacity-40 -rotate-[0.8deg]',
        isOverlay && 'border-primary shadow-drag cursor-grabbing',
        done && 'opacity-70',
        pending && 'opacity-60',
        // The design marks the insertion point with a teal edge along the top
        // of the card that is about to be displaced, rather than by opening a
        // gap — the column keeps its rhythm while you aim.
        showDropLine && 'shadow-[inset_0_3px_0_0_hsl(var(--primary))]',
        justLanded && 'animate-card-drop',
      )}
      {...attributes}
      {...listeners}
    >
      {!minimal ? (
        <div className="label-id text-faint flex items-center gap-2">
          {shows('task_number') ? <span>{`${card.task_prefix}-${card.task_number}`}</span> : null}
          {shows('priority') ? (
            <span className="ms-auto" style={{ color: PRIORITY_STRIPE[card.priority] }}>
              {priorityLabel(card.priority)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/*
        * `draggable={false}` matters more than it looks: an anchor is natively
        * draggable, so without it a drag starting on the title handed the
        * browser a link drag — you got the task's URL as a drag payload
        * instead of the card moving. Turning the native behaviour off lets the
        * pointer events reach the sortable listeners on the card.
        *
        * The listeners are reached precisely BECAUSE this no longer stops
        * propagation on pointer down. A plain click still navigates: the
        * sensor is distance-constrained, so it never activates without 6px of
        * travel, and dnd-kit only starts swallowing clicks once it has.
        */}
      <Link
        href={href}
        draggable={false}
        className={cn(
          'hover:text-primary block text-task leading-[1.35] transition-colors',
          closed ? 'text-faint line-through' : 'text-foreground',
        )}
      >
        {card.title}
      </Link>

      {shows('labels') && card.labels.length > 0 ? (
        <ul className="flex flex-wrap gap-[5px]">
          {card.labels.map((label) => (
            <li
              key={label.id}
              className="bg-chip rounded-[5px] px-[7px] py-0.5 text-tag"
              style={{ color: label.color }}
            >
              {label.name}
            </li>
          ))}
        </ul>
      ) : null}

      {shows('subtask_progress') && card.subtask_total > 0 ? (
        <div className="flex items-center gap-[7px]">
          <span className="bg-chip block h-[3px] flex-1 overflow-hidden rounded-sm">
            <span
              className="bg-primary block h-full transition-[width]"
              style={{ width: `${subtaskPct}%` }}
            />
          </span>
          <span className="text-subtle font-mono text-meta tabular-nums">
            {card.subtask_done}/{card.subtask_total}
          </span>
        </div>
      ) : null}

      {/*
        * The subtask chip, and the checklist it unfolds.
        *
        * Unlike the progress bar above it, this is NOT gated on the view's card
        * fields: the design shows the chip on any card that has subtasks, in
        * every card mode, because it is the card's way into work that would
        * otherwise need the task opened. The bar summarises; this acts.
        */}
      {card.subtask_total > 0 ? (
        <>
          <button
            type="button"
            title="Show subtasks"
            aria-expanded={subtasksOpen}
            onClick={() => setSubtasksOpen((open) => !open)}
            // Same guard the title link uses: without it the 6px drag sensor
            // swallows the click and the chip never opens.
            onPointerDown={(event) => event.stopPropagation()}
            className="bg-chip text-faint hover:text-foreground flex items-center gap-1.5 self-start rounded-[6px] px-2 py-[3px] font-mono text-[9px] uppercase leading-none tracking-[0.08em] tabular-nums transition-colors"
          >
            <span aria-hidden className="text-[7px]">
              {subtasksOpen ? '\u25BC' : '\u25B6'}
            </span>
            {card.subtask_done}/{card.subtask_total} SUBTASKS
          </button>

          {subtasksOpen ? (
            <ul className="border-border flex flex-col gap-0.5 border-t pt-px">
              {card.subtasks.map((subtask) => {
                const subtaskDone = subtask.status === 'done' || subtask.status === 'cancelled'
                return (
                  <li key={subtask.id} className="flex items-center gap-[7px] py-1">
                    <label
                      className={cn('inline-flex shrink-0', scope ? 'cursor-pointer' : 'pointer-events-none')}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="peer sr-only"
                        checked={subtaskDone}
                        disabled={!scope || pending}
                        onChange={(event) => toggleSubtaskDone(subtask.id, event.target.checked)}
                      />
                      <span
                        aria-hidden
                        className={cn(
                          'grid h-3 w-3 place-items-center rounded-[4px] border-[1.5px] text-[7.5px] transition-colors',
                          subtaskDone
                            ? 'border-primary bg-primary text-[#04120F]'
                            : 'border-input text-transparent',
                          'peer-focus-visible:ring-ring/60 peer-focus-visible:ring-2',
                        )}
                      >
                        ✓
                      </span>
                      <span className="sr-only">
                        {subtaskDone ? 'Mark as not done' : 'Mark as done'}: {subtask.title}
                      </span>
                    </label>

                    <span
                      className={cn(
                        'truncate text-micro',
                        subtaskDone ? 'text-subtle line-through' : 'text-muted-foreground',
                      )}
                    >
                      {subtask.title}
                    </span>

                    <span
                      className="text-subtle ms-auto shrink-0 font-mono text-[8.5px] uppercase"
                      title={subtask.assignee_name ?? 'Unassigned'}
                    >
                      {subtask.assignee_name ? initials(subtask.assignee_name) : '\u2014'}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </>
      ) : null}

      <div className="flex items-center gap-2">
        {scope ? (
          <label
            className="inline-flex shrink-0 cursor-pointer"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={done}
              disabled={pending}
              onChange={(event) => toggleDone(event.target.checked)}
            />
            <span
              aria-hidden
              className={cn(
                'grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] text-[9.5px] transition-colors',
                done
                  ? 'border-primary bg-primary text-[#04120F]'
                  : 'border-input text-subtle hover:border-muted-foreground',
                'peer-focus-visible:ring-ring/60 peer-focus-visible:ring-2',
              )}
            >
              ✓
            </span>
            <span className="sr-only">
              {done ? 'Mark as not done' : 'Mark as done'}: {card.title}
            </span>
          </label>
        ) : null}

        {shows('assignee') ? (
          <span
            className="bg-chip text-muted-foreground grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full text-meta font-medium uppercase"
            title={card.assignee?.full_name ?? 'Unassigned'}
          >
            {card.assignee?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- avatars are remote and already sized
              <img src={card.assignee.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(card.assignee?.full_name ?? '–')
            )}
          </span>
        ) : null}

        {!minimal && shows('estimated_hours') && points ? (
          <span className="label-id text-faint">{points} PTS</span>
        ) : null}

        {shows('time_logged') && points ? (
          <span className="label-id text-subtle">{(points * 0.8).toFixed(1)}h</span>
        ) : null}

        <span className="ms-auto flex items-center gap-2">
          {shows('due_date') ? (
            <DueDate dueDate={card.due_date} today={today} isClosed={closed} />
          ) : null}
          {card.is_blocked ? <span className="label-id text-destructive">BLOCKED</span> : null}
        </span>
      </div>
    </li>
  )
}
