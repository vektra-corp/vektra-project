'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult } from '@pm/shared/types'
import { dateStringSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

interface Scope {
  orgSlug: string
  workspaceSlug: string
  projectId: string
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

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('tasks')
      .update({ start_date: parsed.data.start_date, due_date: parsed.data.due_date })
      .eq('id', taskId)
      .eq('project_id', scope.projectId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`/${scope.orgSlug}/${scope.workspaceSlug}/projects/${scope.projectId}/timeline`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
