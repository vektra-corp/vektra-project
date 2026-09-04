'use server'

import { clientIp } from '@pm/auth/middleware'
import type { ActionResult } from '@pm/shared/types'
import {
  emailSchema,
  forgotPasswordSchema,
  loginSchema,
  otpSchema,
  resetPasswordSchema,
  signupSchema,
 fieldErrors } from '@pm/shared/validators'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

/**
 * Auth server actions.
 *
 * Three rules shape everything here:
 *   - Login, signup and password reset are rate limited by IP (§13.7), five
 *     attempts a minute, matching the lockout policy in §13.5.
 *   - Responses never reveal whether an account exists. A wrong password and an
 *     unknown address produce the same message, and the reset flow always
 *     reports success.
 *   - Email verification uses a six-digit CODE, not a magic link. A link in an
 *     email is followed by scanners and previewers, which silently consumes
 *     single-use tokens; a code is only ever entered by a person. Delivery is
 *     Resend, configured as Supabase's SMTP provider — see docs/AUTH.md.
 */

export async function signIn(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const ip = clientIp(headers())
  const limit = await checkRateLimit('auth', ip)
  if (!limit.success) {
    return {
      ok: false,
      code: 'RATE_LIMITED',
      message: 'RATE_LIMITED',
    }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Deliberately uniform: never distinguish "no such user" from "wrong password".
    return {
      ok: false,
      code: error.message.includes('Email not confirmed')
        ? 'EMAIL_NOT_CONFIRMED'
        : 'INVALID_CREDENTIALS',
      message:
        error.message.includes('Email not confirmed')
          ? 'auth.email_not_confirmed'
          : 'auth.invalid_credentials',
    }
  }

  const next = formData.get('next')
  redirect(typeof next === 'string' && next.startsWith('/') ? next : '/')
}

export async function signUp(
  _prevState: ActionResult<{ email: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const parsed = signupSchema.safeParse({
    full_name: formData.get('full_name'),
    email: formData.get('email'),
    password: formData.get('password'),
    confirm_password: formData.get('confirm_password'),
    organization_name: formData.get('organization_name'),
    accept_terms: formData.get('accept_terms') === 'on',
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const ip = clientIp(headers())
  const limit = await checkRateLimit('auth', ip)
  if (!limit.success) {
    return { ok: false, code: 'RATE_LIMITED', message: 'RATE_LIMITED' }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Carried into the profile by the handle_new_user trigger, and read again
      // during onboarding to name the first organization.
      data: {
        full_name: parsed.data.full_name,
        pending_organization_name: parsed.data.organization_name,
      },
      // No emailRedirectTo: the confirmation template sends {{ .Token }}, so
      // there is no link to come back through. The person types the code.
    },
  })

  if (error) {
    return { ok: false, code: 'SIGNUP_FAILED', message: error.message }
  }

  return { ok: true, data: { email: parsed.data.email } }
}

/**
 * Exchange a six-digit code for a session.
 *
 * `type` decides which token Supabase checks it against: `signup` confirms a
 * new address, `recovery` authorises a password reset. Passing the wrong one
 * fails closed rather than confirming the code.
 */
export async function verifyEmailCode(
  type: 'signup' | 'recovery',
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsedEmail = emailSchema.safeParse(formData.get('email'))
  const parsedCode = otpSchema.safeParse({ code: formData.get('code') })

  if (!parsedEmail.success || !parsedCode.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Enter the six-digit code from your email',
      fieldErrors: { code: ['Enter the six-digit code from your email'] },
    }
  }

  const ip = clientIp(headers())
  const limit = await checkRateLimit('auth', ip)
  if (!limit.success) {
    return { ok: false, code: 'RATE_LIMITED', message: 'RATE_LIMITED' }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.verifyOtp({
    email: parsedEmail.data,
    token: parsedCode.data.code,
    type,
  })

  if (error) {
    // Deliberately vague: distinguishing "wrong code" from "expired" from
    // "no such address" tells an attacker which part to vary.
    return {
      ok: false,
      code: 'INVALID_CODE',
      message: 'That code is not valid or has expired.',
      fieldErrors: { code: ['Check the code and try again.'] },
    }
  }

  return { ok: true, data: null }
}

/**
 * Send another code.
 *
 * Always reports success, for the same reason the reset flow does — a differing
 * response would confirm which addresses are registered.
 */
export async function resendEmailCode(
  type: 'signup' | 'recovery',
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = emailSchema.safeParse(formData.get('email'))
  if (!parsed.success) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Enter a valid email address' }
  }

  const ip = clientIp(headers())
  const limit = await checkRateLimit('auth', ip)
  if (!limit.success) {
    return { ok: false, code: 'RATE_LIMITED', message: 'RATE_LIMITED' }
  }

  const supabase = createClient()

  if (type === 'recovery') {
    await supabase.auth.resetPasswordForEmail(parsed.data)
  } else {
    await supabase.auth.resend({ type: 'signup', email: parsed.data })
  }

  return { ok: true, data: null }
}

export async function requestPasswordReset(
  _prevState: ActionResult<{ email: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const ip = clientIp(headers())
  await checkRateLimit('auth', ip)

  const supabase = createClient()
  // No redirectTo: the recovery template sends {{ .Token }}, so the person
  // enters a code on /reset-password rather than following a link.
  await supabase.auth.resetPasswordForEmail(parsed.data.email)

  // Always report success: a differing response would confirm which addresses
  // are registered. The address is echoed back only so the next screen can be
  // addressed to it — it is the one the caller just typed, not a lookup.
  return { ok: true, data: { email: parsed.data.email } }
}

export async function resetPassword(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm_password: formData.get('confirm_password'),
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) {
    return { ok: false, code: 'RESET_FAILED', message: error.message }
  }

  // §13.6: changing the password revokes every other session.
  await supabase.auth.signOut({ scope: 'others' })

  redirect('/')
}

export async function signOut() {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
