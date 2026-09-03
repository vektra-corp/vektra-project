import type { DependencyType, Priority, TaskStatus } from '../constants/statuses'
import type { Json, Timestamps, UUID, UserSummary } from './common'
import type { Label } from './project'

export interface Task extends Timestamps {
  id: UUID
  organization_id: UUID
  project_id: UUID
  kanban_column_id: UUID | null
  title: string
  description: Json | null
  status: TaskStatus
  priority: Priority
  assignee_id: UUID | null
  assigner_id: UUID | null
  start_date: string | null
  due_date: string | null
  estimated_hours: number | null
  actual_hours: number | null
  position: number
  task_number: number
  is_milestone: boolean
  started_at: string | null
  completed_at: string | null
  created_by: UUID | null
}

/** Task as rendered on a Kanban card or report row. */
export interface TaskWithRelations extends Task {
  assignee: UserSummary | null
  assigner: UserSummary | null
  labels: Label[]
  subtask_count: number
  completed_subtask_count: number
  comment_count: number
  attachment_count: number
  /** Minutes logged against this task across all time entries. */
  time_logged_minutes: number
}

export interface Subtask extends Timestamps {
  id: UUID
  organization_id: UUID
  task_id: UUID
  kanban_column_id: UUID | null
  title: string
  description: Json | null
  status: TaskStatus
  priority: Priority
  assignee_id: UUID | null
  due_date: string | null
  estimated_hours: number | null
  position: number
  completed_at: string | null
  created_by: UUID | null
}

export interface SubtaskWithRelations extends Subtask {
  assignee: UserSummary | null
}

export interface TaskDependency {
  id: UUID
  organization_id: UUID
  predecessor_id: UUID
  successor_id: UUID
  dependency_type: DependencyType
  lag_days: number
}
