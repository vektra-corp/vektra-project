import type { Priority, TaskStatus } from '@pm/shared/constants'
import { cn } from '@pm/ui'
import { ChevronDown, ChevronsUp, ChevronUp, Minus } from 'lucide-react'

/**
 * Priority indicator. Colour alone never carries the meaning — each level has a
 * distinct glyph and a text label, so it survives greyscale and colour blindness.
 */
const PRIORITY_STYLES: Record<
  Priority,
  { icon: typeof ChevronUp; className: string; label: string }
> = {
  critical: {
    icon: ChevronsUp,
    className: 'text-[hsl(var(--priority-critical))]',
    label: 'Urgent',
  },
  high: { icon: ChevronUp, className: 'text-[hsl(var(--priority-high))]', label: 'High' },
  medium: { icon: Minus, className: 'text-muted-foreground', label: 'Med' },
  low: { icon: ChevronDown, className: 'text-faint', label: 'Low' },
}

export function TaskPriorityIcon({
  priority,
  showLabel = false,
}: {
  priority: Priority
  showLabel?: boolean
}) {
  const style = PRIORITY_STYLES[priority]
  const Icon = style.icon

  return (
    <span className={cn('label-id inline-flex items-center gap-1 uppercase', style.className)}>
      <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      <span className={showLabel ? '' : 'sr-only'}>
        {style.label}
        {showLabel ? '' : ' priority'}
      </span>
    </span>
  )
}

/** Left edge stripe colour, keyed to priority (§19.8 card_color_by). */
export const PRIORITY_STRIPE: Record<Priority, string> = {
  critical: 'hsl(var(--priority-critical))',
  high: 'hsl(var(--priority-high))',
  medium: 'hsl(var(--priority-medium))',
  low: 'hsl(var(--priority-low))',
}

/*
 * Status chips carry their colour on the text over one neutral fill, rather
 * than each tinting its own background. On a dark ground five different
 * translucent fills read as five different panel colours; one fill with five
 * inks keeps the row calm and still tells them apart.
 */
const STATUS_STYLES: Record<TaskStatus, { className: string; label: string }> = {
  todo: { className: 'text-muted-foreground', label: 'To Do' },
  in_progress: { className: 'text-status-progress', label: 'In Progress' },
  in_review: { className: 'text-status-review', label: 'In Review' },
  done: { className: 'text-status-done', label: 'Done' },
  cancelled: { className: 'text-faint line-through', label: 'Cancelled' },
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <span
      className={cn(
        'bg-chip inline-flex rounded-sm px-2 py-[3px] text-micro font-medium uppercase',
        style.className,
      )}
    >
      {style.label}
    </span>
  )
}

/**
 * Due date, flagged when overdue.
 *
 * Comparison is string-based on `yyyy-MM-dd` because due_date is a calendar
 * date with no timezone — converting it to a Date would shift it for anyone
 * west of UTC (§21.6).
 */
export function DueDate({
  dueDate,
  today,
  isClosed,
}: {
  dueDate: string | null
  today: string
  isClosed: boolean
}) {
  if (!dueDate) return null
  const overdue = !isClosed && dueDate < today
  const dueToday = !isClosed && dueDate === today

  return (
    <span
      className={cn(
        'label-id uppercase tabular-nums',
        overdue ? 'text-destructive' : dueToday ? 'text-warning' : 'text-faint',
      )}
    >
      {overdue ? 'OVERDUE ' : ''}
      {dueDate.slice(5)}
    </span>
  )
}
