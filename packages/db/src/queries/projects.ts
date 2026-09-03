import { COLUMNS, type Db, unwrap, unwrapList, unwrapMaybe } from '../helpers'
import type { TablesInsert, TablesUpdate } from '../types'

export async function listProjects(db: Db, orgId: string, workspaceId?: string) {
  let query = db
    .from('projects')
    .select(COLUMNS.projectListItem)
    .eq('organization_id', orgId)
    .neq('status', 'archived')

  if (workspaceId) query = query.eq('workspace_id', workspaceId)

  return unwrapList(await query.order('updated_at', { ascending: false }))
}

export async function getProject(db: Db, projectId: string) {
  return unwrapMaybe(
    await db
      .from('projects')
      .select(
        'id, organization_id, workspace_id, name, description, status, priority, start_date, end_date, budget, visibility, settings, created_at, updated_at',
      )
      .eq('id', projectId)
      .maybeSingle(),
  )
}

export async function createProject(db: Db, input: TablesInsert<'projects'>) {
  return unwrap(await db.from('projects').insert(input).select(COLUMNS.projectListItem).single())
}

export async function updateProject(
  db: Db,
  projectId: string,
  patch: TablesUpdate<'projects'>,
) {
  return unwrap(
    await db
      .from('projects')
      .update(patch)
      .eq('id', projectId)
      .select(COLUMNS.projectListItem)
      .single(),
  )
}

export async function listProjectMembers(db: Db, projectId: string) {
  return unwrapList(
    await db
      .from('project_members')
      .select(`id, role, joined_at, profile:profiles!inner(${COLUMNS.profileSummary})`)
      .eq('project_id', projectId),
  )
}

/** The default board for a project, with its columns in display order. */
export async function getDefaultBoard(db: Db, projectId: string) {
  const board = unwrapMaybe(
    await db
      .from('kanban_boards')
      .select('id, name')
      .eq('project_id', projectId)
      .eq('is_default', true)
      .maybeSingle(),
  )
  if (!board) return null

  const columns = unwrapList(
    await db
      .from('kanban_columns')
      .select('id, name, color, position, wip_limit, is_done_column, status')
      .eq('board_id', board.id)
      .order('position'),
  )

  return { ...board, columns }
}

/**
 * Counts for the project list cards. Uses head-only count queries so no row
 * data crosses the wire just to render a number.
 */
export async function getProjectStats(db: Db, projectId: string) {
  const [total, open] = await Promise.all([
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    db
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('status', 'in', '(done,cancelled)'),
  ])

  const totalCount = total.count ?? 0
  const openCount = open.count ?? 0

  return {
    task_count: totalCount,
    open_task_count: openCount,
    completion: totalCount === 0 ? 0 : (totalCount - openCount) / totalCount,
  }
}
