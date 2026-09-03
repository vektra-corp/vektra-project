'use server'

import { assertCan } from '@pm/auth/rbac'
import * as taskService from '@pm/db'
import { sanitizeTiptapJson } from '@pm/shared/sanitize'
import type { ActionResult } from '@pm/shared/types'
import {
  commentCreateSchema,
  fieldErrors,
  subtaskCreateSchema,
  taskCreateSchema,
  taskMoveSchema,
  taskUpdateSchema,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth/context'
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

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

export async function createTask(
  scope: Scope,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'create')

  const parsed = taskCreateSchema.safeParse({
    project_id: scope.projectId,
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
    const { label_ids, ...task } = parsed.data
    const created = await taskService.createTask(supabase, {
      ...task,
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
  const { error } = await supabase.from('subtasks').insert({
    ...subtask,
    // §13.1: rich text is sanitized before storage, never on render.
    description: description ? (sanitizeTiptapJson(description) as never) : null,
    organization_id: auth.orgId,
    created_by: auth.userId,
  })

  if (error) return { ok: false, code: 'INTERNAL_ERROR', message: error.message }

  revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
  return { ok: true, data: null }
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

// --- Comments ----------------------------------------------------------------

export async function createComment(
  scope: Scope,
  taskId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)

  const text = String(formData.get('body') ?? '').trim()
  if (!text) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Comment cannot be empty' }
  }

  // Stored as a Tiptap document from day one, so switching the composer to the
  // real editor later needs no data migration.
  const body = {
    type: 'doc',
    content: text.split(/\n{2,}/).map((paragraph) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: paragraph }],
    })),
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

// --- shared -------------------------------------------------------------------

function toActionError(error: unknown): ActionResult<never> {
  const code = (error as { code?: string })?.code
  const message = error instanceof Error ? error.message : 'Something went wrong'
  return {
    ok: false,
    code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    message,
  }
}
