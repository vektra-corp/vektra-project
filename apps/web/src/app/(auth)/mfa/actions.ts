'use server'

import type { ActionResult } from '@pm/shared/types'
import { redirect } from 'next/navigation'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

/**
 * Second-factor challenge (§13.5).
 *
 * Enrolment lives in settings; this is the sign-in half — the code prompt shown
 * to someone who has a verified factor and a session still at `aal1`.
 *
 * A TOTP code is six digits, so it is guessable at a rate that matters. It uses
 * the same limiter as password attempts, keyed by USER rather than IP: the
 * account is what is under attack, and whoever already has the password can
 * change address trivially.
 *
 * `redirect()` works by throwing, so it is called outside any try block — a
 * catch would swallow the redirect and turn a success into an error.
 */
export async function verifySecondFactor(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const code = String(formData.get('code') ?? '').replace(/\s/g, '')
  const next = String(formData.get('next') ?? '')

  if (!/^\d{6}$/.test(code)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Enter the six-digit code.' }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const limit = await checkRateLimit('auth', `mfa:${user.id}`)
  if (!limit.success) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Wait a moment and try again.',
    }
  }

  const factor = (user.factors ?? []).find((entry) => entry.status === 'verified')
  // Nothing to verify against — middleware would not have sent them here.
  if (!factor) redirect('/')

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  })

  if (challengeError || !challenge) {
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Could not start the check.' }
  }

  const { error } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  })

  if (error) {
    // Uniform message: a wrong code and an expired one look identical to the
    // person typing, and telling them apart tells an attacker which it was.
    return { ok: false, code: 'INVALID_CREDENTIALS', message: 'That code was not correct.' }
  }

  redirect(next.startsWith('/') ? next : '/')
}
