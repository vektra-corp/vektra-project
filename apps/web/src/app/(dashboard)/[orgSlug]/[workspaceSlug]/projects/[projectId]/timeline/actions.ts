'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult } from '@pm/shared/types'
import { dateStringSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
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

const rescheduleSchema = z
  .object({
    start_date: dateStringSchema,
    due_date: dateStringSchema,
  })
  // Mirrors the same rule taskUpdateSchema enforces: a bar can never be dragged
  // into a negative duration.
  .refine((data) => data.start_date <= data.due_date, {
    message: 'A task cannot end before it starts',
    path: ['due_date'],
  })

/**
 * Move or resize a task on the timeline.
 *
 * Narrower than `updateTask` on purpose: a drag may only ever change the two
 * dates, so this is the whole writable surface and nothing else on the row can
 * be reached through it.
 */
export async function rescheduleTask(
  scope: Scope,
  taskId: string,
  startDate: string,
  dueDate: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(scope.orgSlug)
  assertCan(auth, 'tasks', 'update')

  const parsed = rescheduleSchema.safeParse({ start_date: startDate, due_date: dueDate })
  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message ?? 'Invalid dates',
    }
  }

  const project = await projectUuid(scope)
  if (!project.ok) return project.error

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('tasks')
      .update({ start_date: parsed.data.start_date, due_date: parsed.data.due_date })
      .eq('id', taskId)
      .eq('project_id', project.id)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/timeline`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
