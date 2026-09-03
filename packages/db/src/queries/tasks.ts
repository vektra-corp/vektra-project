import { COLUMNS, type Db, decodeCursor, encodeCursor, pageSize, unwrapList, unwrapMaybe } from '../helpers'

/** Tasks grouped by Kanban column, the shape the board renders. */
export async function listBoardTasks(db: Db, projectId: string) {
  return unwrapList(
    await db
      .from('tasks')
      .select(
        `${COLUMNS.taskCard},
         assignee:profiles!tasks_assignee_id_fkey(${COLUMNS.profileSummary}),
         task_labels(label:labels(id, name, color))`,
      )
      .eq('project_id', projectId)
      .order('position', { ascending: true }),
  )
}

export async function getTask(db: Db, taskId: string) {
  return unwrapMaybe(
    await db
      .from('tasks')
      .select(
        `${COLUMNS.taskDetail},
         assignee:profiles!tasks_assignee_id_fkey(${COLUMNS.profileSummary}),
         assigner:profiles!tasks_assigner_id_fkey(${COLUMNS.profileSummary}),
         task_labels(label:labels(id, name, color))`,
      )
      .eq('id', taskId)
      .maybeSingle(),
  )
}

/*
 * Write operations deliberately live in the service layer, not here.
 *
 * createTask / updateTask / moveTask / deleteTask used to be duplicated in this
 * file. Calling those would have skipped the plan-limit check and the
 * column/status coupling that business rule 3 depends on, so there is now
 * exactly one way to mutate a task: @pm/db's task service.
 */

export async function listSubtasks(db: Db, taskId: string) {
  return unwrapList(
    await db
      .from('subtasks')
      .select(
        `id, title, status, priority, assignee_id, due_date, position, kanban_column_id, completed_at,
         assignee:profiles!subtasks_assignee_id_fkey(${COLUMNS.profileSummary})`,
      )
      .eq('task_id', taskId)
      .order('position'),
  )
}

export interface TaskReportFilters {
  projectIds?: string[]
  assigneeIds?: string[]
  statuses?: string[]
  priorities?: string[]
  dueFrom?: string
  dueTo?: string
}

/**
 * Paginated task report (§19.7). Keyset pagination on (updated_at, id) so deep
 * pages stay fast as the table grows.
 */
export async function listTaskReport(
  db: Db,
  orgId: string,
  filters: TaskReportFilters,
  page: { cursor?: string | null; limit?: number } = {},
) {
  const limit = pageSize(page.limit)
  const cursor = decodeCursor(page.cursor)

  let query = db
    .from('tasks')
    .select(
      `${COLUMNS.taskDetail},
       assignee:profiles!tasks_assignee_id_fkey(${COLUMNS.profileSummary}),
       assigner:profiles!tasks_assigner_id_fkey(${COLUMNS.profileSummary}),
       project:projects(id, name)`,
    )
    .eq('organization_id', orgId)

  if (filters.projectIds?.length) query = query.in('project_id', filters.projectIds)
  if (filters.assigneeIds?.length) query = query.in('assignee_id', filters.assigneeIds)
  if (filters.statuses?.length) query = query.in('status', filters.statuses)
  if (filters.priorities?.length) query = query.in('priority', filters.priorities)
  if (filters.dueFrom) query = query.gte('due_date', filters.dueFrom)
  if (filters.dueTo) query = query.lte('due_date', filters.dueTo)

  if (cursor) {
    query = query.or(
      `updated_at.lt.${cursor.value},and(updated_at.eq.${cursor.value},id.lt.${cursor.id})`,
    )
  }

  const rows = unwrapList(
    await query
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1),
  )

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)

  return {
    items,
    has_more: hasMore,
    next_cursor:
      hasMore && last ? encodeCursor({ value: String(last.updated_at), id: String(last.id) }) : null,
  }
}

/** Tasks assigned to a user that are due within `days`, for the dashboard. */
export async function listUpcomingTasks(db: Db, userId: string, days = 7) {
  const until = new Date()
  until.setDate(until.getDate() + days)

  return unwrapList(
    await db
      .from('tasks')
      .select(`${COLUMNS.taskCard}, project:projects(id, name)`)
      .eq('assignee_id', userId)
      .not('status', 'in', '(done,cancelled)')
      .not('due_date', 'is', null)
      .lte('due_date', until.toISOString().slice(0, 10))
      .order('due_date', { ascending: true })
      .limit(50),
  )
}
