import type { Priority, TaskStatus } from '@pm/shared/constants'

export interface KanbanCardData {
  /** Task uuid: what a move or an update is written against. */
  id: string
  /** 16-digit public id: what the task's URL is built from. */
  publicId: string
  title: string
  status: TaskStatus
  priority: Priority
  due_date: string | null
  position: number
  task_number: number
  /** Project key shown before the number, e.g. the ATL in ATL-241. */
  task_prefix: string
  kanban_column_id: string | null
  estimated_hours: number | null
  /** True when a predecessor dependency is still open (§6.2 task_dependencies). */
  is_blocked: boolean
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
  labels: { id: string; name: string; color: string }[]
  subtask_total: number
  subtask_done: number
  comment_count: number
}

export interface KanbanColumnData {
  id: string
  name: string
  color: string | null
  position: number
  wip_limit: number | null
  is_done_column: boolean
  status: TaskStatus
  /**
   * The grouped attribute this column represents. Equals `status` for the
   * default grouping, and the assignee id / priority / label id for the others
   * (§19.8); null is the "unassigned" / "no label" column.
   */
  value?: string | null
  /**
   * Set only when the board is grouped by assignee: the design heads such a
   * column with the person's avatar in place of the status dot, so the column
   * needs the name to take initials from.
   */
  avatarLabel?: string | null
}

export interface KanbanScope {
  orgSlug: string
  workspaceSlug: string
  /** The project's 16-digit public id, as the URL carries it. */
  projectId: string
}

/**
 * Column accent, keyed by the workflow stage rather than the column name so a
 * renamed column keeps its colour. An explicit column colour still wins.
 */
export const STATUS_ACCENT: Record<TaskStatus, string> = {
  todo: 'hsl(var(--status-backlog))',
  in_progress: 'hsl(var(--status-progress))',
  in_review: 'hsl(var(--status-review))',
  done: 'hsl(var(--status-done))',
  cancelled: 'hsl(var(--status-backlog))',
}
