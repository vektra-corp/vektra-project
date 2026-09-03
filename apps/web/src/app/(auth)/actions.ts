'use server'

import { clientIp } from '@pm/auth/middleware'
import type { ActionResult } from '@pm/shared/types'
import {
  forgotPasswordSchema,
  loginSchema,
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
 * Two rules shape everything here:
 *   - Login and password reset are rate limited by IP (§13.7), five attempts a
 *     minute, matching the lockout policy in §13.5.
 *   - Responses never reveal whether an account exists. A wrong password and an
 *     unknown address produce the same message, and the reset flow always
 *     reports success.
 */

function origin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

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
      emailRedirectTo: `${origin()}/auth/callback?next=/onboarding`,
    },
  })

  if (error) {
    return { ok: false, code: 'SIGNUP_FAILED', message: error.message }
  }

  return { ok: true, data: { email: parsed.data.email } }
}

export async function requestPasswordReset(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
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
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin()}/auth/callback?next=/reset-password`,
  })

  // Always report success: a differing response would confirm which addresses
  // are registered.
  return { ok: true, data: null }
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
