'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, cn } from '@pm/ui'
import { MessageSquare, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { DueDate, TaskPriorityIcon } from '@/components/tasks/task-badges'
import type { KanbanCardData } from './types'

export function KanbanCard({
  card,
  href,
  today,
  isOverlay = false,
}: {
  card: KanbanCardData
  href: string
  today: string
  /** Rendered inside the drag overlay rather than in a column. */
  isOverlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', card },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border bg-card p-3 shadow-sm',
        // The original stays in place as a placeholder while the overlay follows
        // the cursor; hiding it entirely would make the list jump.
        isDragging && !isOverlay && 'opacity-40',
        isOverlay && 'rotate-2 shadow-lg',
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          className="text-sm font-medium leading-snug hover:underline"
          // Let a click through to the link without the drag sensor stealing it.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {card.title}
        </Link>
        <TaskPriorityIcon priority={card.priority} />
      </div>

      {card.labels.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <li
              key={label.id}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{ backgroundColor: `${label.color}22`, color: label.color }}
            >
              {label.name}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">#{card.task_number}</span>
          {card.subtask_total > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular-nums">
                {card.subtask_done}/{card.subtask_total}
              </span>
            </span>
          ) : null}
          {card.comment_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              <span className="tabular-nums">{card.comment_count}</span>
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <DueDate
            dueDate={card.due_date}
            today={today}
            isClosed={card.status === 'done' || card.status === 'cancelled'}
          />
          {card.assignee ? (
            <Avatar className="h-6 w-6">
              {card.assignee.avatar_url ? (
                <AvatarImage src={card.assignee.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="text-[10px]">
                {initials(card.assignee.full_name)}
              </AvatarFallback>
            </Avatar>
          ) : null}
        </div>
      </div>
    </li>
  )
}
