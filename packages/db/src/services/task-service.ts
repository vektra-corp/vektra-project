import { CLOSED_TASK_STATUSES, positionBetween } from '@pm/shared'
import { appError } from '@pm/shared/errors'
import { COLUMNS, type Db, unwrap, unwrapList, unwrapMaybe } from '../helpers'
import type { TablesInsert, TablesUpdate } from '../types'
import { assertPlanLimit, incrementUsage } from './plan-limits'

/**
 * Task business logic (claude.md §22.2).
 *
 * Services take a Supabase client and enforce business rules. They do NOT do
 * auth, validation or HTTP — that is the API layer's job. Keeping them free of
 * request concerns is what makes them testable and reusable from Inngest jobs.
 */

export interface CreateTaskInput extends Omit<TablesInsert<'tasks'>, 'organization_id' | 'task_number'> {
  orgId: string
  /** Null when a workflow created the task — no person did. */
  userId: string | null
  labelIds?: string[]
}

export async function createTask(db: Db, input: CreateTaskInput) {
  const { orgId, userId, labelIds = [], ...task } = input

  await assertPlanLimit(db, orgId, 'tasks')

  // Business rule 3: a card always sits in a column, and the column determines
  // the status. When the caller does not name one, use the board's first column.
  let columnId = task.kanban_column_id ?? null
  let status = task.status ?? 'todo'

  if (columnId) {
    status = await statusForColumn(db, columnId)
  } else {
    const column = await firstColumnFor(db, task.project_id)
    if (column) {
      columnId = column.id
      status = column.status
    }
  }

  /*
   * task_number is deliberately absent: the set_task_number trigger allocates
   * it (business rule 1 — sequential per project, never reused).
   *
   * The generated Insert type still marks it required, because the column is
   * NOT NULL with no *column* default; the default comes from a trigger, which
   * the type generator cannot see. The cast records that, rather than making
   * every caller invent a number the database is about to overwrite.
   */
  const payload = {
    ...task,
    kanban_column_id: columnId,
    status,
    organization_id: orgId,
    created_by: userId,
    // Whoever creates a task with an assignee is the one assigning it.
    assigner_id: task.assignee_id ? userId : null,
  } as TablesInsert<'tasks'>

  const created = unwrap(
    await db.from('tasks').insert(payload).select(COLUMNS.taskDetail).single(),
  )

  if (labelIds.length > 0) {
    await db.from('task_labels').insert(
      labelIds.map((labelId) => ({
        task_id: created.id,
        label_id: labelId,
        organization_id: orgId,
      })),
    )
  }

  await incrementUsage(db, orgId, 'tasks')
  return created
}

export async function updateTask(
  db: Db,
  taskId: string,
  patch: TablesUpdate<'tasks'>,
  options: { userId: string; labelIds?: string[]; orgId: string },
) {
  // Changing the status must move the card too, or the board and the row
  // disagree (business rule 3).
  const next: TablesUpdate<'tasks'> = { ...patch }
  if (patch.status) {
    const column = await columnForStatus(db, taskId, patch.status)
    if (column) next.kanban_column_id = column
  }

  // Record who made an assignment, so the task report's "Assigned by" is real.
  if (patch.assignee_id) next.assigner_id = options.userId

  const updated = unwrap(
    await db.from('tasks').update(next).eq('id', taskId).select(COLUMNS.taskDetail).single(),
  )

  if (options.labelIds) {
    await db.from('task_labels').delete().eq('task_id', taskId)
    if (options.labelIds.length > 0) {
      await db.from('task_labels').insert(
        options.labelIds.map((labelId) => ({
          task_id: taskId,
          label_id: labelId,
          organization_id: options.orgId,
        })),
      )
    }
  }

  return updated
}

/**
 * Move a card between columns.
 *
 * Enforces the WIP limit and writes column + status + position together, so the
 * board can never end up showing a card in a column whose status it does not
 * have (business rule 3).
 *
 * Generic over the table because a subtask board is the same board: the same
 * `kanban_columns` rows, the same WIP semantics, the same coupling of column to
 * status. Only the table holding the cards differs.
 */
export async function moveCard(
  db: Db,
  table: 'tasks' | 'subtasks',
  cardId: string,
  targetColumnId: string,
  position: number,
) {
  const column = unwrapMaybe(
    await db
      .from('kanban_columns')
      .select('id, name, status, wip_limit')
      .eq('id', targetColumnId)
      .maybeSingle(),
  )
  if (!column) throw appError('NOT_FOUND', 'Target column not found')

  if (column.wip_limit !== null) {
    // Counted on the same table the card lives in — a subtask board's limit
    // must not be measured against the project's tasks.
    const { count } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('kanban_column_id', targetColumnId)
      .neq('id', cardId)

    if ((count ?? 0) >= column.wip_limit) {
      throw appError('WIP_LIMIT', `Column "${column.name}" has reached its WIP limit`, {
        column: column.name,
        limit: column.wip_limit,
      })
    }
  }

  return unwrap(
    await db
      .from(table)
      .update({
        kanban_column_id: targetColumnId,
        status: column.status,
        position,
      })
      .eq('id', cardId)
      .select('id, kanban_column_id, status, position')
      .single(),
  )
}

/** Task-board wrapper, kept so existing callers read the same. */
export async function moveTask(
  db: Db,
  taskId: string,
  targetColumnId: string,
  position: number,
) {
  return moveCard(db, 'tasks', taskId, targetColumnId, position)
}

/** Subtask-board equivalent (§20 Phase 2, subtask Kanban). */
export async function moveSubtask(
  db: Db,
  subtaskId: string,
  targetColumnId: string,
  position: number,
) {
  return moveCard(db, 'subtasks', subtaskId, targetColumnId, position)
}

/**
 * Fractional position for a drop between two cards, so moving one card writes
 * one row rather than renumbering the whole column.
 */
export function positionForDrop(
  ordered: readonly { id: string; position: number }[],
  targetIndex: number,
): number {
  const before = ordered[targetIndex - 1]?.position ?? null
  const after = ordered[targetIndex]?.position ?? null
  return positionBetween(before, after)
}

export async function deleteTask(db: Db, taskId: string, orgId: string) {
  const result = await db.from('tasks').delete().eq('id', taskId)
  if (result.error) throw result.error
  await incrementUsage(db, orgId, 'tasks', -1)
}

/** Progress across a task's subtasks, for the card's progress bar. */
export async function subtaskProgress(db: Db, taskIds: readonly string[]) {
  if (taskIds.length === 0) return new Map<string, { total: number; done: number }>()

  const rows = unwrapList(
    await db.from('subtasks').select('task_id, status').in('task_id', [...taskIds]),
  )

  const progress = new Map<string, { total: number; done: number }>()
  for (const row of rows) {
    const entry = progress.get(row.task_id) ?? { total: 0, done: 0 }
    entry.total += 1
    if ((CLOSED_TASK_STATUSES as readonly string[]).includes(row.status)) entry.done += 1
    progress.set(row.task_id, entry)
  }
  return progress
}

// --- internals ---------------------------------------------------------------

async function statusForColumn(db: Db, columnId: string): Promise<string> {
  const column = unwrapMaybe(
    await db.from('kanban_columns').select('status').eq('id', columnId).maybeSingle(),
  )
  if (!column) throw appError('NOT_FOUND', 'Column not found')
  return column.status
}

async function firstColumnFor(db: Db, projectId: string) {
  const board = unwrapMaybe(
    await db
      .from('kanban_boards')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_default', true)
      .maybeSingle(),
  )
  if (!board) return null

  return unwrapMaybe(
    await db
      .from('kanban_columns')
      .select('id, status')
      .eq('board_id', board.id)
      .order('position')
      .limit(1)
      .maybeSingle(),
  )
}

/** The column on a task's board that represents a given status. */
async function columnForStatus(db: Db, taskId: string, status: string): Promise<string | null> {
  const task = unwrapMaybe(
    await db.from('tasks').select('project_id').eq('id', taskId).maybeSingle(),
  )
  if (!task) return null

  const board = unwrapMaybe(
    await db
      .from('kanban_boards')
      .select('id')
      .eq('project_id', task.project_id)
      .eq('is_default', true)
      .maybeSingle(),
  )
  if (!board) return null

  const column = unwrapMaybe(
    await db
      .from('kanban_columns')
      .select('id')
      .eq('board_id', board.id)
      .eq('status', status)
      .order('position')
      .limit(1)
      .maybeSingle(),
  )
  return column?.id ?? null
}
