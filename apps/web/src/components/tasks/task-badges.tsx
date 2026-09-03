import type { Priority, TaskStatus } from '@pm/shared/constants'
import { cn } from '@pm/ui'
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react'

/** Priority indicator. Colour alone never carries the meaning — each has an icon. */
const PRIORITY_STYLES: Record<Priority, { icon: typeof ArrowUp; className: string; label: string }> = {
  critical: { icon: AlertTriangle, className: 'text-[hsl(var(--priority-critical))]', label: 'Critical' },
  high: { icon: ArrowUp, className: 'text-[hsl(var(--priority-high))]', label: 'High' },
  medium: { icon: Minus, className: 'text-[hsl(var(--priority-medium))]', label: 'Medium' },
  low: { icon: ArrowDown, className: 'text-[hsl(var(--priority-low))]', label: 'Low' },
}

export function TaskPriorityIcon({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  const style = PRIORITY_STYLES[priority]
  const Icon = style.icon

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', style.className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className={showLabel ? '' : 'sr-only'}>{style.label} priority</span>
    </span>
  )
}

const STATUS_STYLES: Record<TaskStatus, { className: string; label: string }> = {
  todo: { className: 'bg-muted text-muted-foreground', label: 'To Do' },
  in_progress: { className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', label: 'In Progress' },
  in_review: { className: 'bg-purple-500/15 text-purple-700 dark:text-purple-300', label: 'In Review' },
  done: { className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', label: 'Done' },
  cancelled: { className: 'bg-muted text-muted-foreground line-through', label: 'Cancelled' },
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', style.className)}>
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
        'text-xs tabular-nums',
        overdue ? 'font-medium text-destructive' : dueToday ? 'font-medium text-amber-600' : 'text-muted-foreground',
      )}
    >
      {overdue ? 'Overdue ' : ''}
      {dueDate}
    </span>
  )
}
