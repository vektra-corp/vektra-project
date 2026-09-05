'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { isCardFieldVisible, type KanbanViewConfig } from '@pm/shared/constants'
import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, cn } from '@pm/ui'
import { ListChecks, MessageSquare } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setTaskDone } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/actions'
import { DueDate, PRIORITY_STRIPE, TaskPriorityIcon } from '@/components/tasks/task-badges'
import type { KanbanCardData, KanbanScope } from './types'

export function KanbanCard({
  card,
  href,
  today,
  scope,
  view,
  isOverlay = false,
}: {
  card: KanbanCardData
  href: string
  today: string
  /** Absent in the drag overlay, where the completion toggle is not interactive. */
  scope?: KanbanScope
  /** Which fields this board's saved view shows (§19.8). */
  view: Pick<KanbanViewConfig, 'card_fields' | 'compact_mode'>
  /** Rendered inside the drag overlay rather than in a column. */
  isOverlay?: boolean
}) {
  const shows = (field: Parameters<typeof isCardFieldVisible>[1]) =>
    isCardFieldVisible(view, field)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card },
  })
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const done = card.status === 'done'
  const closed = done || card.status === 'cancelled'
  const points = card.estimated_hours

  function toggleDone(next: boolean) {
    if (!scope) return
    startTransition(async () => {
      await setTaskDone(scope, card.id, next)
      router.refresh()
    })
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        // The stripe is the card's own left border, so it never shifts the
        // content box the way an absolutely positioned bar would on wrap.
        'border-border bg-card group relative overflow-hidden rounded-lg border transition-colors',
        'hover:border-input',
        // The original stays in place as a placeholder while the overlay follows
        // the cursor; hiding it entirely would make the list jump.
        isDragging && !isOverlay && 'opacity-40',
        isOverlay && 'border-input shadow-drag rotate-1',
        pending && 'opacity-60',
      )}
      {...attributes}
      {...listeners}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-[3px]"
        style={{ backgroundColor: PRIORITY_STRIPE[card.priority] }}
      />

      {/* 12px of padding inside the 3px stripe, per the design. */}
      <div className="flex flex-col gap-2 py-[11px] pe-3 ps-[15px]">
        <div className="flex items-center justify-between gap-2">
          <span className="label-id text-faint">
            {shows('task_number') ? `${card.task_prefix}-${card.task_number}` : null}
          </span>
          {shows('priority') ? <TaskPriorityIcon priority={card.priority} showLabel /> : null}
        </div>

        <Link
          href={href}
          className={cn(
            'hover:text-primary block text-task transition-colors',
            closed ? 'text-faint line-through' : 'text-foreground',
          )}
          // Let a click through to the link without the drag sensor stealing it.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {card.title}
        </Link>

        {shows('labels') && card.labels.length > 0 ? (
          <ul className="flex flex-wrap gap-[5px]">
            {card.labels.map((label) => (
              <li
                key={label.id}
                className="text-tag rounded-sm px-[7px] py-0.5"
                style={{ backgroundColor: `${label.color}1f`, color: label.color }}
              >
                {label.name}
              </li>
            ))}
          </ul>
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
                  'flex h-[18px] w-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors',
                  done
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input hover:border-muted-foreground text-transparent',
                  'peer-focus-visible:ring-ring/60 peer-focus-visible:ring-2',
                )}
              >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden>
                  <path
                    d="m2.5 6.2 2.3 2.3 4.7-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="sr-only">
                {done ? 'Mark as not done' : 'Mark as done'}: {card.title}
              </span>
            </label>
          ) : null}

          {shows('assignee') && card.assignee ? (
            <Avatar className="h-5 w-5" title={card.assignee.full_name}>
              {card.assignee.avatar_url ? (
                <AvatarImage src={card.assignee.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="bg-chip text-muted-foreground text-[9px] font-medium uppercase">
                {initials(card.assignee.full_name)}
              </AvatarFallback>
            </Avatar>
          ) : null}

          {shows('estimated_hours') && points ? (
            <span className="label-id text-faint">{points} PTS</span>
          ) : null}

          {shows('subtask_progress') && card.subtask_total > 0 ? (
            <span className="label-id text-faint inline-flex items-center gap-1">
              <ListChecks className="h-3 w-3" aria-hidden />
              {card.subtask_done}/{card.subtask_total}
            </span>
          ) : null}

          {card.comment_count > 0 ? (
            <span className="label-id text-faint inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" aria-hidden />
              {card.comment_count}
            </span>
          ) : null}

          <span className="ms-auto flex items-center gap-2">
            {shows('due_date') ? (
              <DueDate dueDate={card.due_date} today={today} isClosed={closed} />
            ) : null}
            {card.is_blocked ? <span className="label-id text-destructive">BLOCKED</span> : null}
          </span>
        </div>
      </div>
    </li>
  )
}
