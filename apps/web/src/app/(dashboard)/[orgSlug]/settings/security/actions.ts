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

// --- second factor (§13.5) ----------------------------------------------------

/**
 * Begin TOTP enrolment.
 *
 * Returns the QR image and the secret in plain text. Both are shown once, in
 * the browser of the person enrolling, and neither is stored by us — Supabase
 * holds the factor. The secret is offered alongside the QR because a code
 * cannot be scanned on the device that is displaying it.
 */
export async function startTotpEnrolment(): Promise<
  ActionResult<{ factorId: string; qrCode: string; secret: string }>
> {
  try {
    const supabase = createClient()

    // An abandoned enrolment leaves an unverified factor behind. Clearing them
    // first keeps a second attempt from failing on the friendly-name conflict,
    // and stops them accumulating.
    const { data: existing } = await supabase.auth.mfa.listFactors()
    for (const factor of existing?.all ?? []) {
      if (factor.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}`,
    })

    if (error || !data) {
      return { ok: false, code: 'INTERNAL_ERROR', message: error?.message ?? 'Could not start enrolment.' }
    }

    return {
      ok: true,
      data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Confirm enrolment with a code from the authenticator.
 *
 * Verifying is what moves the factor to `verified`, and only a verified factor
 * is enforced at sign-in — so an enrolment that stops here changes nothing.
 */
export async function confirmTotpEnrolment(
  orgSlug: string,
  factorId: string,
  code: string,
): Promise<ActionResult<null>> {
  try {
    await requireAuth(orgSlug)

    const clean = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(clean)) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Enter the six-digit code.' }
    }

    const supabase = createClient()
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeError || !challenge) {
      return { ok: false, code: 'INTERNAL_ERROR', message: 'Could not start the check.' }
    }

    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: clean,
    })

    if (error) {
      return {
        ok: false,
        code: 'INVALID_CREDENTIALS',
        message: 'That code was not correct. Check your device clock and try again.',
      }
    }

    revalidatePath(`/${orgSlug}/settings/security`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Remove a factor.
 *
 * Supabase requires the caller's session to be at aal2 to unenrol a verified
 * factor, so someone who has stolen an aal1 session cannot switch it off. That
 * is enforced by Supabase rather than here; the error is surfaced plainly.
 */
export async function removeTotpFactor(
  orgSlug: string,
  factorId: string,
): Promise<ActionResult<null>> {
  try {
    await requireAuth(orgSlug)
    const supabase = createClient()

    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    if (error) {
      return { ok: false, code: 'FORBIDDEN', message: error.message }
    }

    revalidatePath(`/${orgSlug}/settings/security`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
