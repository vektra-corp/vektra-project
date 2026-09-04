'use server'

import { sanitizeTiptapJson } from '@pm/shared/sanitize'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requirePortal } from '@/lib/auth/portal'
import { createClient } from '@/lib/supabase/server'

/**
 * Portal comment posting.
 *
 * Separate from the internal comment action on purpose. A portal user has no
 * org role, so `assertCan` cannot express their permission; it comes from the
 * `can_comment` flag on their `portal_project_access` row instead. The comment
 * is always written with `is_internal = false`, which is the flag the RLS
 * policy uses to keep internal discussion out of the portal.
 */
export async function createPortalComment(
  orgSlug: string,
  projectId: string,
  taskId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const portal = await requirePortal(orgSlug)
  const supabase = createClient()

  try {
    // Re-read the grant rather than trusting anything from the client: the flag
    // may have been revoked since the page rendered.
    const { data: access } = await supabase
      .from('portal_project_access')
      .select('can_comment')
      .eq('portal_user_id', portal.portalUserId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!access?.can_comment) {
      return { ok: false, code: 'FORBIDDEN', message: 'You cannot comment on this project.' }
    }

    // The task must belong to the project that was shared; without this, a
    // crafted task id would post into a project this user cannot see.
    const { data: task } = await supabase
      .from('tasks')
      .select('id')
      .eq('id', taskId)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!task) return { ok: false, code: 'NOT_FOUND', message: 'That task is not in this project.' }

    const raw = String(formData.get('body') ?? '').trim()
    if (!raw) return { ok: false, code: 'VALIDATION_ERROR', message: 'Comment cannot be empty' }

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

    const { error } = await supabase.from('comments').insert({
      task_id: taskId,
      organization_id: portal.orgId,
      author_id: portal.userId,
      // §13.1: sanitize before storage, not on render.
      body: sanitizeTiptapJson(body) as never,
      // A portal user can never author an internal note.
      is_internal: false,
    })

    if (error) throw error

    revalidatePath(`/portal/${orgSlug}/projects/${projectId}`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
