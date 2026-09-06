'use server'

import { assertCan } from '@pm/auth/rbac'
import * as taskService from '@pm/db'
import { sanitizeTiptapJson } from '@pm/shared/sanitize'
import type { ActionResult } from '@pm/shared/types'
import {
  commentCreateSchema,
  fieldErrors,
  subtaskCreateSchema,
  subtaskMoveSchema,
  taskCreateSchema,
  taskMoveSchema,
  taskUpdateSchema,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

/**
 * Task, subtask and comment mutations for one project.
 *
 * Rich text (descriptions, comment bodies) is sanitized here, server-side,
 * BEFORE storage (claude.md §13.1) — so every later reader of the row inherits
 * the guarantee rather than re-sanitizing on render.
 */

function projectPath(orgSlug: string, workspaceSlug: string, projectId: string) {
  return `/${orgSlug}/${workspaceSlug}/projects/${projectId}`
}

/**
 * A scope always holds the ids the URL held, so `projectId` is the project's
 * 16-digit public id — right for building a path, wrong for a foreign key.
 * Anything that writes resolves it through `resolveProject` first, which also
 * makes the project's existence and visibility a precondition of the write.
 */
interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/** The uuid behind a scope, or a failure the caller can return as-is. */
async function projectUuid(
  scope: Scope,
): Promise<{ ok: true; id: string } | { ok: false; error: ActionResult<never> }> {
  const project = await resolveProject(scope.projectId)
  if (!project) {
    return {
      ok: false,
      error: { ok: false, code: 'NOT_FOUND', message: 'That project was not found.' },
    }
  }
  return { ok: true, id: project.id }
}

export async function createTask(
  scope: Scope,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'create')

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const parsed = taskCreateSchema.safeParse({
    project_id: project.id,
    kanban_column_id: formData.get('kanban_column_id') || null,
    title: formData.get('title'),
    priority: formData.get('priority') || 'medium',
    assignee_id: formData.get('assignee_id') || null,
    due_date: formData.get('due_date') || null,
    estimated_hours: formData.get('estimated_hours')
      ? Number(formData.get('estimated_hours'))
      : null,
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()

  try {
    const { label_ids, description, ...task } = parsed.data
    const created = await taskService.createTask(supabase, {
      ...task,
      // §13.1: rich text is sanitized before storage, never on render.
      ...(description ? { description: sanitizeTiptapJson(description) as never } : {}),
      orgId: auth.orgId,
      userId: auth.userId,
      labelIds: label_ids,
    })

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: { id: created.id } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateTask(
  scope: Scope,
  taskId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const rawDescription = formData.get('description')
  const parsed = taskUpdateSchema.safeParse({
    title: formData.get('title') ?? undefined,
    description: rawDescription ? JSON.parse(String(rawDescription)) : undefined,
    status: formData.get('status') ?? undefined,
    priority: formData.get('priority') ?? undefined,
    assignee_id: formData.get('assignee_id') || null,
    due_date: formData.get('due_date') || null,
    start_date: formData.get('start_date') || null,
    estimated_hours: formData.get('estimated_hours')
      ? Number(formData.get('estimated_hours'))
      : null,
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()

  try {
    const { label_ids, description, ...patch } = parsed.data
    await taskService.updateTask(
      supabase,
      taskId,
      {
        ...patch,
        // §13.1: sanitize before storage, not on render.
        ...(description !== undefined
          ? { description: sanitizeTiptapJson(description) as never }
          : {}),
      },
      { userId: auth.userId, orgId: auth.orgId, labelIds: label_ids },
    )

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Kanban drop. Column and status move together (business rule 3) and the WIP
 * limit is enforced in the service, so a blocked drop returns WIP_LIMIT and the
 * client reverts its optimistic update.
 */
export async function moveTask(
  scope: Scope,
  input: { task_id: string; target_column_id: string; position: number },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const parsed = taskMoveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'VALIDATION_ERROR' }
  }

  const supabase = createClient()

  try {
    await taskService.moveTask(
      supabase,
      parsed.data.task_id,
      parsed.data.target_column_id,
      parsed.data.position,
    )
    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteTask(scope: Scope, taskId: string): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'delete')

  const supabase = createClient()
  try {
    await taskService.deleteTask(supabase, taskId, auth.orgId)
    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// --- Subtasks (business rule 2: two levels only, enforced by the schema) ------

export async function createSubtask(
  scope: Scope,
  taskId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'create')

  const parsed = subtaskCreateSchema.safeParse({
    task_id: taskId,
    // Present when created from the subtask board; absent from the checklist.
    kanban_column_id: formData.get('kanban_column_id') || null,
    title: formData.get('title'),
    priority: formData.get('priority') || 'medium',
    assignee_id: formData.get('assignee_id') || null,
    due_date: formData.get('due_date') || null,
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()
  const { description, ...subtask } = parsed.data

  // The column carries the status (business rule 3), so a subtask created into
  // a column takes that column's status rather than the default.
  let status = subtask.status
  let position = 0
  if (subtask.kanban_column_id) {
    const [{ data: column }, { data: last }] = await Promise.all([
      supabase
        .from('kanban_columns')
        .select('status')
        .eq('id', subtask.kanban_column_id)
        .eq('organization_id', auth.orgId)
        .maybeSingle(),
      supabase
        .from('subtasks')
        .select('position')
        .eq('kanban_column_id', subtask.kanban_column_id)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    if (!column) {
      return { ok: false, code: 'NOT_FOUND', message: 'That column no longer exists.' }
    }
    status = column.status as typeof status
    // Appended, with room to insert above it later without renumbering.
    position = (last?.position ?? 0) + 1000
  }

  const { error } = await supabase.from('subtasks').insert({
    ...subtask,
    status,
    position,
    // §13.1: rich text is sanitized before storage, never on render.
    description: description ? (sanitizeTiptapJson(description) as never) : null,
    organization_id: auth.orgId,
    created_by: auth.userId,
  })

  if (error) return { ok: false, code: 'INTERNAL_ERROR', message: error.message }

  revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
  return { ok: true, data: null }
}

/**
 * Move a subtask on its board (§20 Phase 2).
 *
 * Goes through the shared `moveCard`, which owns the WIP check and writes
 * column and status together — the same guarantee the task board has, rather
 * than a second implementation that could drift from it.
 */
export async function moveSubtask(
  scope: Scope,
  input: { subtask_id: string; target_column_id: string; position: number },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const parsed = subtaskMoveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'VALIDATION_ERROR' }
  }

  const supabase = createClient()

  try {
    await taskService.moveSubtask(
      supabase,
      parsed.data.subtask_id,
      parsed.data.target_column_id,
      parsed.data.position,
    )
    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function toggleSubtask(scope: Scope, subtaskId: string, done: boolean) {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const supabase = createClient()
  // The auto_set_task_timestamps trigger fills completed_at; setting it here
  // would fight the database for ownership of that column.
  await supabase
    .from('subtasks')
    .update({ status: done ? 'done' : 'todo' })
    .eq('id', subtaskId)

  revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
}

/**
 * Completion toggle on a Kanban card.
 *
 * §18 rule 3: the column is the source of truth for status, so this moves the
 * card to the board's done column rather than writing `status` on its own —
 * otherwise a card could read "done" while still sitting in In Progress.
 */
export async function setTaskDone(
  scope: Scope,
  taskId: string,
  done: boolean,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const supabase = createClient()

  const { data: board } = await supabase
    .from('kanban_boards')
    .select('id')
    .eq('project_id', project.id)
    .eq('is_default', true)
    .maybeSingle()

  if (!board) {
    return { ok: false, code: 'NOT_FOUND', message: 'This project has no board.' }
  }

  const { data: columns } = await supabase
    .from('kanban_columns')
    .select('id, is_done_column')
    .eq('board_id', board.id)
    .order('position')

  // Re-opening returns the card to the first open column, which is where an
  // un-started task belongs on every default board.
  const target = done
    ? columns?.find((column) => column.is_done_column)
    : columns?.find((column) => !column.is_done_column)

  if (!target) {
    return {
      ok: false,
      code: 'NO_TARGET_COLUMN',
      message: done ? 'This board has no done column.' : 'This board has no open column.',
    }
  }

  // Append rather than insert: a card that changes column should land at the
  // end of its new column, not silently take another card's slot.
  const { data: last } = await supabase
    .from('tasks')
    .select('position')
    .eq('kanban_column_id', target.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  try {
    await taskService.moveTask(supabase, taskId, target.id, (last?.position ?? 0) + 1000)
    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// --- Comments ----------------------------------------------------------------

export async function createComment(
  scope: Scope,
  taskId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)

  const raw = String(formData.get('body') ?? '').trim()
  if (!raw) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Comment cannot be empty' }
  }

  // The composer posts a Tiptap document. A body that is not JSON is treated as
  // plain text rather than rejected, so a comment still lands if the editor
  // failed to hydrate.
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    body = {
      type: 'doc',
      content: raw.split(/\n{2,}/).map((paragraph) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: paragraph }],
      })),
    }
  }

  const parsed = commentCreateSchema.safeParse({
    task_id: taskId,
    body,
    is_internal: formData.get('is_internal') === 'on',
  })

  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'VALIDATION_ERROR' }
  }

  const supabase = createClient()
  const { error } = await supabase.from('comments').insert({
    task_id: taskId,
    organization_id: auth.orgId,
    author_id: auth.userId,
    body: sanitizeTiptapJson(parsed.data.body) as never,
    is_internal: parsed.data.is_internal,
  })

  if (error) return { ok: false, code: 'INTERNAL_ERROR', message: error.message }

  revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
  return { ok: true, data: null }
}
