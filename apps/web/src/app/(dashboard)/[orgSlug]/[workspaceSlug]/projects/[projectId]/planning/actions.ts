'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
}

/**
 * The uuid behind a scope, or a failure the caller can return as-is.
 *
 * `scope.projectId` is the 16-digit public id the URL carried; foreign keys are
 * uuids. Resolving here also makes the project's existence and visibility a
 * precondition of the write.
 */
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

function planningPath(scope: Scope) {
  return `/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/planning`
}

/**
 * Move tasks into or out of a sprint.
 *
 * A null `sprintId` returns them to the backlog, so commit and un-commit are
 * the same write rather than two paths that could drift apart.
 *
 * The project id is part of the filter as well as the ids: RLS already confines
 * this to the caller's org, but without it a task from a *different project in
 * the same org* could be committed to this project's sprint by a crafted
 * request — which RLS has no reason to refuse, because the org matches.
 */
export async function setTaskSprint(
  scope: Scope,
  taskIds: string[],
  sprintId: string | null,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  if (taskIds.length === 0) return { ok: true, data: null }

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const supabase = createClient()

  try {
    if (sprintId) {
      const { data: sprint } = await supabase
        .from('sprints')
        .select('id')
        .eq('id', sprintId)
        .eq('project_id', project.id)
        .maybeSingle()
      if (!sprint) return { ok: false, code: 'NOT_FOUND', message: 'Sprint not found' }
    }

    const { error } = await supabase
      .from('tasks')
      .update({ sprint_id: sprintId })
      .eq('project_id', project.id)
      .in('id', taskIds)

    if (error) throw error

    revalidatePath(planningPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/** Open the next sprint for a project. */
export async function createSprint(
  scope: Scope,
  input: { name: string; startsOn: string; endsOn: string },
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'projects', 'update')

  const name = input.name.trim()
  if (!name) return { ok: false, code: 'VALIDATION_ERROR', message: 'Name is required' }
  if (input.endsOn < input.startsOn) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'A sprint cannot end before it starts',
    }
  }

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const supabase = createClient()

  try {
    const { data, error } = await supabase
      .from('sprints')
      .insert({
        organization_id: auth.orgId,
        project_id: project.id,
        name,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        created_by: auth.userId,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(planningPath(scope))
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    return toActionError(error)
  }
}
