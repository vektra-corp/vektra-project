'use server'

import type { ActionResult } from '@pm/shared/types'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export interface MentionCandidate {
  id: string
  full_name: string
  avatar_url: string | null
}

/**
 * People the caller may @mention on a task.
 *
 * Thin wrapper over `mentionable_members` (migration 00036), which is the thing
 * that decides who is eligible: the task's project members and its workspace
 * members, and nobody else. Keeping that rule in the database means the
 * autocomplete and the notification fan-out cannot drift apart and start
 * offering names that would then be silently dropped.
 *
 * The function is SECURITY INVOKER, so a caller who cannot see the task gets an
 * empty list — the picker is never a directory of the organization.
 */
export async function searchMentionableMembers(
  orgSlug: string,
  taskId: string,
  query: string,
): Promise<ActionResult<MentionCandidate[]>> {
  await requireAuth(orgSlug)

  const supabase = createClient()
  const { data, error } = await supabase.rpc('mentionable_members', {
    p_task_id: taskId,
    p_query: query.trim().slice(0, 60),
  })

  if (error) return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
  return { ok: true, data: (data ?? []) as MentionCandidate[] }
}
