'use server'

import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Session management (§13.6).
 *
 * Both actions delegate to SECURITY DEFINER functions (00032) that do the
 * authorisation themselves, because revoking means deleting a row in the `auth`
 * schema, which no end-user role can reach. The functions return false rather
 * than raising when the caller is not entitled, so this layer cannot leak
 * whether a given session id exists.
 */

export async function revokeSession(
  orgSlug: string,
  sessionRowId: string,
): Promise<ActionResult<null>> {
  try {
    await requireAuth(orgSlug)
    const supabase = createClient()

    const { data, error } = await supabase.rpc('revoke_user_session', { p_id: sessionRowId })
    if (error) throw error

    if (!data) {
      return { ok: false, code: 'FORBIDDEN', message: 'That session could not be revoked.' }
    }

    revalidatePath(`/${orgSlug}/settings/security`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * End every other session, keeping the one making the request.
 *
 * The current session is identified from the JWT rather than passed in by the
 * client — otherwise someone could keep a session they do not hold.
 */
export async function revokeOtherSessions(orgSlug: string): Promise<ActionResult<{ count: number }>> {
  try {
    await requireAuth(orgSlug)
    const supabase = createClient()

    const { data: sessionData } = await supabase.auth.getSession()
    let keep: string | null = null

    if (sessionData.session) {
      try {
        const claims = JSON.parse(
          Buffer.from(sessionData.session.access_token.split('.')[1] ?? '', 'base64url').toString(),
        ) as { session_id?: string }
        keep = claims.session_id ?? null
      } catch {
        // Without a session id every session is ended, including this one.
        // Signing the person out is the safe direction for a control whose
        // whole purpose is to lock other devices out.
        keep = null
      }
    }

    // The generated signature takes an optional string; null and "absent" mean
    // the same thing to the function, which defaults the argument.
    const { data, error } = await supabase.rpc('revoke_other_sessions', {
      p_keep: keep ?? undefined,
    })
    if (error) throw error

    revalidatePath(`/${orgSlug}/settings/security`)
    return { ok: true, data: { count: typeof data === 'number' ? data : 0 } }
  } catch (error) {
    return toActionError(error)
  }
}
