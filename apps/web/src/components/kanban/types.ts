import type { Priority, TaskStatus } from '@pm/shared/constants'

export interface KanbanCardData {
  id: string
  title: string
  status: TaskStatus
  priority: Priority
  due_date: string | null
  position: number
  task_number: number
  kanban_column_id: string | null
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
}

export interface KanbanScope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}
