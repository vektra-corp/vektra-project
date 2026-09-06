import type { Priority, TaskStatus } from '@pm/shared/constants'

export interface GanttTask {
  /** Task uuid: what a reschedule is written against. */
  id: string
  /** 16-digit public id: what the task's URL is built from. */
  publicId: string
  title: string
  taskNumber: number
  status: TaskStatus
  priority: Priority
  /** Both `yyyy-MM-dd`. A task needs at least one to be placed on the chart. */
  startDate: string | null
  dueDate: string | null
  isMilestone: boolean
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
}

export interface GanttDependency {
  predecessorId: string
  successorId: string
  type: string
}

export interface GanttScope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}
