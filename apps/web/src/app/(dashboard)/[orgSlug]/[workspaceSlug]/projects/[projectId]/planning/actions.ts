'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
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

  const supabase = createClient()

  try {
    if (sprintId) {
      const { data: sprint } = await supabase
        .from('sprints')
        .select('id')
        .eq('id', sprintId)
        .eq('project_id', scope.projectId)
        .maybeSingle()
      if (!sprint) return { ok: false, code: 'NOT_FOUND', message: 'Sprint not found' }
    }

    const { error } = await supabase
      .from('tasks')
      .update({ sprint_id: sprintId })
      .eq('project_id', scope.projectId)
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

  const supabase = createClient()

  try {
    const { data, error } = await supabase
      .from('sprints')
      .insert({
        organization_id: auth.orgId,
        project_id: scope.projectId,
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
