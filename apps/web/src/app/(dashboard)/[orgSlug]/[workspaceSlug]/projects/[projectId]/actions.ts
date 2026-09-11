'use server'

import { assertCan, canCreateTask, canDeleteTask, canUpdateTask } from '@pm/auth/rbac'
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
import { loadProjectAccess } from '@/lib/auth/project-access'
import { notifyTaskChange } from '@/lib/notifications/task-events'
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

  /*
   * Project-level gate on top of the org matrix: the project may reserve task
   * creation for its managers, and a viewer may never create regardless of what
   * their org role allows (§2 — both must pass).
   *
   * RETURNED, not thrown. `assertPermission` and friends throw, which is right
   * for an unreachable state but wrong here: a member hitting a policy that is
   * working exactly as configured is an expected outcome, and an uncaught throw
   * escapes the action, trips the route's error boundary, and tells them
   * "something went wrong fetching this data" — hiding both the reason and the
   * fact that the refusal was deliberate.
   */
  const access = await loadProjectAccess(auth, project.id)
  if (!canCreateTask(access)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message:
        access.taskCreatePolicy === 'managers'
          ? 'This project only lets project managers create tasks.'
          : 'You are not a member of this project.',
    }
  }

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

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const access = await loadProjectAccess(auth, project.id)
  if (!canUpdateTask(access)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'You do not have permission to change tasks in this project.',
    }
  }

  const rawDescription = formData.get('description')

  /**
   * Three states, not two.
   *
   * A key that is ABSENT means "this form was not about that field, leave it
   * alone". A key that is PRESENT BUT EMPTY means "clear it". Collapsing the
   * two into `formData.get(key) || null` is what let the description editor —
   * which posts nothing but `description` — silently null the assignee, both
   * dates and the estimate of every task whose description was ever saved.
   */
  const optionalText = (key: string): string | null | undefined => {
    if (!formData.has(key)) return undefined
    const raw = String(formData.get(key) ?? '').trim()
    return raw === '' ? null : raw
  }

  const rawHours = optionalText('estimated_hours')

  const parsed = taskUpdateSchema.safeParse({
    title: formData.get('title') ?? undefined,
    description: rawDescription ? JSON.parse(String(rawDescription)) : undefined,
    status: formData.get('status') ?? undefined,
    priority: formData.get('priority') ?? undefined,
    assignee_id: optionalText('assignee_id'),
    due_date: optionalText('due_date'),
    start_date: optionalText('start_date'),
    estimated_hours: rawHours === undefined || rawHours === null ? rawHours : Number(rawHours),
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

    // Read before writing: the notification has to say what CHANGED, and after
    // the update the old values are gone. One extra read on a path that is
    // already writing, in exchange for "priority raised to critical" instead of
    // an unhelpful "the task was updated".
    const { data: before } = await supabase
      .from('tasks')
      .select('title, status, priority, due_date, assignee_id, assigner_id')
      .eq('id', taskId)
      .maybeSingle()

    const updated = await taskService.updateTask(
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

    await notifyTaskChange({
      orgId: auth.orgId,
      orgSlug: scope.orgSlug,
      workspaceSlug: scope.workspaceSlug,
      projectId: project.id,
      actorId: auth.userId,
      before,
      after: updated,
      // `scope.projectId` is the project's 16-digit public id, which is exactly
      // what a URL needs — no extra lookup.
      projectPublicId: scope.projectId,
    })

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

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  // Deleting stays a manager power INSIDE the project too: the org matrix lets
  // a manager delete tasks, but not in a project they have nothing to do with.
  const access = await loadProjectAccess(auth, project.id)
  if (!canDeleteTask(access)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only project managers can delete tasks here.' }
  }

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

/**
 * Rename a board column, or change its work-in-progress limit (§19.8).
 *
 * The design edits both from the board's own settings panel, so this is the
 * write behind that panel. Because a column name IS the status label the board
 * groups on (§18 rule 5), renaming is shaping the project's workflow rather
 * than a personal preference — hence `tasks.update` rather than the `tasks.read`
 * that the saved-view actions are content with.
 *
 * A limit of 0 means "no limit" in the panel's stepper; it is stored as NULL so
 * the WIP check treats it the way the schema intends.
 */
export async function updateKanbanColumn(
  scope: Scope,
  columnId: string,
  patch: { name?: string; wip_limit?: number | null },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const update: { name?: string; wip_limit?: number | null } = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 60)
    if (!name) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'A column needs a name.' }
    }
    update.name = name
  }
  if (patch.wip_limit !== undefined) {
    const limit = patch.wip_limit === null ? null : Math.max(0, Math.trunc(patch.wip_limit))
    update.wip_limit = limit === null || limit === 0 ? null : limit
  }

  if (Object.keys(update).length === 0) return { ok: true, data: null }

  const supabase = createClient()

  try {
    // The board id is not in scope here, so the column is constrained by the
    // tenant and by its board belonging to this project — a column id from
    // another project fails the join rather than being renamed.
    const { data: column, error: readError } = await supabase
      .from('kanban_columns')
      .select('id, board:kanban_boards!kanban_columns_board_id_fkey(project_id)')
      .eq('id', columnId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (readError) throw readError

    const board = Array.isArray(column?.board) ? column.board[0] : column?.board
    if (!column || board?.project_id !== project.id) {
      return { ok: false, code: 'NOT_FOUND', message: 'That column was not found.' }
    }

    const { error } = await supabase
      .from('kanban_columns')
      .update(update)
      .eq('id', columnId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Change one field of a task from a list row (§19.7).
 *
 * `updateTask` exists for the task form, which posts every field at once — it
 * reads `assignee_id` straight off the FormData, so an absent field means
 * "unassign", which is right for a form and catastrophic for a patch. This
 * takes an explicit partial instead: a key that is not present is not touched,
 * and `null` unambiguously means "clear it".
 *
 * The status path still goes through the service, so changing status from the
 * list moves the card on the board too (§18 rule 5).
 */
export async function patchTask(
  scope: Scope,
  taskId: string,
  patch: {
    title?: string
    status?: string
    priority?: string
    assignee_id?: string | null
    due_date?: string | null
  },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  // Only the keys actually sent are validated, so a partial cannot be widened
  // into a full overwrite by a caller that omits half of them.
  const parsed = taskUpdateSchema.safeParse({
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.assignee_id !== undefined ? { assignee_id: patch.assignee_id } : {}),
    ...(patch.due_date !== undefined ? { due_date: patch.due_date } : {}),
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

  // The schema carries `description` for the form's sake; nothing here can set
  // it, so drop it rather than hand the service an untyped Json field.
  const { description: _description, label_ids: _labelIds, ...fields } = parsed.data

  try {
    await taskService.updateTask(supabase, taskId, fields, {
      userId: auth.userId,
      orgId: auth.orgId,
    })

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Replace a task's labels.
 *
 * The whole set is written at once rather than one add/remove at a time: the
 * junction has no ordering and no per-row state, so "these are the labels" is
 * both simpler to reason about and impossible to leave half-applied.
 *
 * Label ids are checked against the caller's own organization before insert.
 * `task_labels` carries `organization_id`, so RLS would catch a foreign label
 * anyway — but it would surface as an opaque policy violation rather than as
 * the validation error this is.
 */
export async function setTaskLabels(
  scope: Scope,
  taskId: string,
  labelIds: string[],
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const unique = [...new Set(labelIds)].slice(0, 20)
  const supabase = createClient()

  try {
    if (unique.length > 0) {
      const { data: valid, error: readError } = await supabase
        .from('labels')
        .select('id')
        .eq('organization_id', auth.orgId)
        .in('id', unique)

      if (readError) throw readError
      if ((valid ?? []).length !== unique.length) {
        return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown label.' }
      }
    }

    const { error: deleteError } = await supabase
      .from('task_labels')
      .delete()
      .eq('task_id', taskId)
    if (deleteError) throw deleteError

    if (unique.length > 0) {
      const { error: insertError } = await supabase
        .from('task_labels')
        .insert(
          unique.map((labelId) => ({
            task_id: taskId,
            label_id: labelId,
            organization_id: auth.orgId,
          })),
        )
      if (insertError) throw insertError
    }

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/** A label's colour, as the picker and the chips render it. */
const LABEL_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * Create a label for this project.
 *
 * Project-scoped rather than org-wide: `labels.project_id` is nullable and a
 * null means "every project in the org sees it", which is a decision about
 * other people's projects. Nothing in a single project's settings should be
 * able to make that, so this always writes the project id and org-wide labels
 * stay an organization-settings concern.
 *
 * The name is unique per project only in this check, not in the schema — there
 * is no unique index on (project_id, name), so this is a courtesy against
 * duplicates rather than a guarantee. Two racing creates can still both land;
 * the cost is a duplicate chip, not a broken row.
 */
export async function createLabel(
  scope: Scope,
  input: { name: string; color: string },
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const name = input.name.trim().slice(0, 40)
  if (!name) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Give the label a name.' }
  }
  if (!LABEL_COLOR.test(input.color)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Pick a colour.' }
  }

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const supabase = createClient()

  try {
    const { data: clash } = await supabase
      .from('labels')
      .select('id')
      .eq('organization_id', auth.orgId)
      .eq('project_id', project.id)
      .ilike('name', name)
      .maybeSingle()

    if (clash) {
      return { ok: false, code: 'ALREADY_EXISTS', message: `“${name}” already exists here.` }
    }

    const { data, error } = await supabase
      .from('labels')
      .insert({
        organization_id: auth.orgId,
        project_id: project.id,
        name,
        color: input.color,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Delete a label.
 *
 * `task_labels` cascades on the label, so this also unlabels every task that
 * carried it — which is the only sensible reading of "delete this label", but
 * is worth the caller confirming first.
 *
 * Scoped to this project's own labels: an org-wide label (project_id IS NULL)
 * is shared with every other project, so removing it from here would delete it
 * out from under them.
 */
export async function deleteLabel(scope: Scope, labelId: string): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('labels')
      .delete()
      .eq('id', labelId)
      .eq('organization_id', auth.orgId)
      .eq('project_id', project.id)

    if (error) throw error

    revalidatePath(projectPath(scope.orgSlug, scope.workspaceSlug, scope.projectId))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
