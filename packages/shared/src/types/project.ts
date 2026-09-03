import type {
  ProjectRole,
  ProjectStatus,
  ProjectVisibility,
  Priority,
} from '../constants/statuses'
import type { Json, Timestamps, UUID, UserSummary } from './common'

export interface Project extends Timestamps {
  id: UUID
  organization_id: UUID
  workspace_id: UUID
  name: string
  description: string | null
  status: ProjectStatus
  priority: Priority | null
  start_date: string | null
  end_date: string | null
  budget: number | null
  visibility: ProjectVisibility
  settings: Record<string, Json>
  created_by: UUID | null
}

export interface ProjectMember {
  id: UUID
  project_id: UUID
  user_id: UUID
  organization_id: UUID
  role: ProjectRole
  joined_at: string
}

export interface ProjectMemberWithProfile extends ProjectMember {
  profile: UserSummary
}

/** Project row decorated with the counts the list view renders. */
export interface ProjectWithStats extends Project {
  task_count: number
  open_task_count: number
  member_count: number
  /** 0-1 fraction of tasks in a done column. */
  completion: number
}

export interface KanbanBoard {
  id: UUID
  project_id: UUID | null
  task_id: UUID | null
  organization_id: UUID
  name: string
  is_default: boolean
  created_at: string
}

export interface KanbanColumn {
  id: UUID
  board_id: UUID
  organization_id: UUID
  name: string
  color: string | null
  position: number
  wip_limit: number | null
  is_done_column: boolean
  created_at: string
}

export interface Label {
  id: UUID
  organization_id: UUID
  project_id: UUID | null
  name: string
  color: string
  created_at: string
}
