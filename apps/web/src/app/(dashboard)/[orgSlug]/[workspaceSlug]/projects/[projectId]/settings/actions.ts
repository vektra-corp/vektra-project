'use server'

import { canManageProject } from '@pm/auth/rbac'
import {
  resolveProjectSettings,
  serializeProjectSettings,
  isLastProtectedColumn,
  isProtectedStatus,
  TASK_CREATE_POLICIES,
  TASK_STATUSES,
  type TaskCreatePolicy,
} from '@pm/shared/constants'
import type { ActionResult, Json } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { assertProjectAccess, loadProjectAccess } from '@/lib/auth/project-access'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

/**
 * Project-scoped governance (§4).
 *
 * These live inside the project rather than in organization settings on
 * purpose: they are decisions about how ONE project is run, and an org-level
 * screen listing every project's task policy would be a table nobody can read.
 * Organization settings keeps what is genuinely org-wide — custom field
 * definitions, roles, billing.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

function projectPath(scope: Scope) {
  return `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}`
}

/** Resolve the public id to a uuid and check the caller may govern this project. */
async function requireProjectManager(scope: Scope) {
  const auth = await requireAuth(scope.orgSlug)
  const resolved = await resolveProject(scope.projectId)
  if (!resolved) {
    return { ok: false as const, error: { ok: false as const, code: 'NOT_FOUND' as const, message: 'That project was not found.' } }
  }

  const access = await loadProjectAccess(auth, resolved.id)
  assertProjectAccess(canManageProject(access), 'Only project managers can change these settings.')

  return { ok: true as const, auth, access, projectUuid: resolved.id }
}

/**
 * Update one project's governance settings.
 *
 * Read-modify-write on the jsonb rather than a blind overwrite: `settings` is
 * shared with anything else that ever stores a per-project preference there,
 * and replacing the whole document would silently drop it.
 */
export async function updateProjectGovernance(
  scope: Scope,
  input: {
    taskCreate?: TaskCreatePolicy
    autoAssign?: boolean
    autoAssignManagers?: boolean
  },
): Promise<ActionResult<null>> {
  const gate = await requireProjectManager(scope)
  if (!gate.ok) return gate.error

  if (input.taskCreate && !TASK_CREATE_POLICIES.includes(input.taskCreate)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown task creation policy.' }
  }

  const supabase = createClient()

  try {
    const { data: project } = await supabase
      .from('projects')
      .select('settings')
      .eq('id', gate.projectUuid)
      .eq('organization_id', gate.auth.orgId)
      .maybeSingle()

    const current = resolveProjectSettings(project?.settings)
    const next = {
      taskCreate: input.taskCreate ?? current.taskCreate,
      autoAssign: input.autoAssign ?? current.autoAssign,
      autoAssignManagers: input.autoAssignManagers ?? current.autoAssignManagers,
    }

    const merged = {
      ...(typeof project?.settings === 'object' && project.settings !== null
        ? (project.settings as Record<string, unknown>)
        : {}),
      ...serializeProjectSettings(next),
    }

    const { error } = await supabase
      .from('projects')
      .update({ settings: merged as Json })
      .eq('id', gate.projectUuid)
      .eq('organization_id', gate.auth.orgId)

    if (error) throw error

    revalidatePath(`${projectPath(scope)}/settings`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * The caller's own notification settings for this project.
 *
 * Not gated by `canManageProject`: "controlled by anyone, for that project and
 * that user only" means every member governs their own attention. RLS enforces
 * the same thing — the policy is `user_id = auth.uid()` on both sides — so a
 * manager cannot write this row for someone else even by calling directly.
 */
export async function updateProjectNotifications(
  scope: Scope,
  input: { muted?: boolean; preferences?: Record<string, { email?: boolean; in_app?: boolean }> },
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)

  const resolved = await resolveProject(scope.projectId)
  if (!resolved) return { ok: false, code: 'NOT_FOUND', message: 'That project was not found.' }

  const supabase = createClient()

  try {
    const { data: existing } = await supabase
      .from('project_notification_preferences')
      .select('preferences, muted')
      .eq('project_id', resolved.id)
      .eq('user_id', auth.userId)
      .maybeSingle()

    const { error } = await supabase.from('project_notification_preferences').upsert(
      {
        organization_id: auth.orgId,
        project_id: resolved.id,
        user_id: auth.userId,
        muted: input.muted ?? existing?.muted ?? false,
        preferences: (input.preferences ??
          (existing?.preferences as Record<string, unknown>) ??
          {}) as Json,
      },
      { onConflict: 'project_id,user_id' },
    )

    if (error) throw error

    revalidatePath(`${projectPath(scope)}/settings`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// -----------------------------------------------------------------------------
// Statuses
//
// A board column IS a status (business rule 3): dragging a card writes both
// `kanban_column_id` and `status`, and they are never allowed to disagree. So
// "add a status" means "add a column", and this is where that happens.
//
// Each column also carries one of the five CANONICAL statuses, which is what
// reporting, automation and the overdue job read. A project can have "Blocked"
// and "In QA" columns; both map to `in_progress`, so "what is still open?" has
// an answer that does not depend on a project's vocabulary. Renaming is free;
// the mapping is what keeps the rest of the product working.
// -----------------------------------------------------------------------------

export async function createProjectStatus(
  scope: Scope,
  input: { name: string; status: string; color?: string | null },
): Promise<ActionResult<{ id: string }>> {
  const gate = await requireProjectManager(scope)
  if (!gate.ok) return gate.error

  const name = input.name.trim().slice(0, 60)
  if (!name) return { ok: false, code: 'VALIDATION_ERROR', message: 'Give the status a name.' }

  if (!TASK_STATUSES.includes(input.status as (typeof TASK_STATUSES)[number])) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown underlying status.' }
  }

  const supabase = createClient()

  try {
    // The project's default board. A project always has one; a project without
    // one has no board to add a column to, which is a different problem.
    const { data: board } = await supabase
      .from('kanban_boards')
      .select('id')
      .eq('project_id', gate.projectUuid)
      .eq('organization_id', gate.auth.orgId)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!board) {
      return { ok: false, code: 'NOT_FOUND', message: 'This project has no board yet.' }
    }

    // Append. Reading the current maximum rather than counting rows, so a gap
    // left by a deletion does not collide.
    const { data: last } = await supabase
      .from('kanban_columns')
      .select('position')
      .eq('board_id', board.id)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: created, error } = await supabase
      .from('kanban_columns')
      .insert({
        board_id: board.id,
        organization_id: gate.auth.orgId,
        name,
        status: input.status,
        color: input.color ?? null,
        position: (last?.position ?? -1) + 1,
        is_done_column: input.status === 'done',
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(projectPath(scope))
    return { ok: true, data: { id: created.id } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Delete a status column.
 *
 * Refuses the three protected statuses, and refuses to strand work: cards in
 * the column are moved to the project's Todo column first, because
 * `kanban_column_id` is ON DELETE SET NULL and a task with a null column
 * disappears from the board while still existing.
 */
export async function deleteProjectStatus(
  scope: Scope,
  columnId: string,
): Promise<ActionResult<{ movedTasks: number }>> {
  const gate = await requireProjectManager(scope)
  if (!gate.ok) return gate.error

  const supabase = createClient()

  try {
    const { data: column } = await supabase
      .from('kanban_columns')
      .select('id, status, board_id, name')
      .eq('id', columnId)
      .eq('organization_id', gate.auth.orgId)
      .maybeSingle()

    if (!column) return { ok: false, code: 'NOT_FOUND', message: 'That status was not found.' }

    // Locked only when it is the last column holding a protected status — a
    // project may add and remove its own "Blocked" beside "In Progress".
    if (isProtectedStatus(column.status)) {
      const { count } = await supabase
        .from('kanban_columns')
        .select('id', { count: 'exact', head: true })
        .eq('board_id', column.board_id)
        .eq('status', column.status)

      if (isLastProtectedColumn(column.status, count ?? 0)) {
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: `“${column.name}” is the only ${column.status.replace('_', ' ')} column, so it cannot be removed. Rename it instead.`,
        }
      }
    }

    // Where the orphans go.
    const { data: fallback } = await supabase
      .from('kanban_columns')
      .select('id, status')
      .eq('board_id', column.board_id)
      .eq('status', 'todo')
      .order('position')
      .limit(1)
      .maybeSingle()

    if (!fallback) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'This board has no Todo column to move the remaining tasks into.',
      }
    }

    const { data: moved, error: moveError } = await supabase
      .from('tasks')
      .update({ kanban_column_id: fallback.id, status: fallback.status })
      .eq('kanban_column_id', columnId)
      .eq('organization_id', gate.auth.orgId)
      .select('id')

    if (moveError) throw moveError

    const { error } = await supabase
      .from('kanban_columns')
      .delete()
      .eq('id', columnId)
      .eq('organization_id', gate.auth.orgId)

    if (error) throw error

    revalidatePath(projectPath(scope))
    return { ok: true, data: { movedTasks: moved?.length ?? 0 } }
  } catch (error) {
    return toActionError(error)
  }
}
