'use server'

import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export interface AdminLoginState {
  error?: string
}

/**
 * Admin sign-in.
 *
 * Authenticating is not enough: the account must also resolve to an active
 * `admin_users` row on the allowlist. A customer who happens to know an admin
 * URL gets signed in and then immediately signed back out.
 */
export async function adminSignIn(
  _prevState: AdminLoginState | null,
  formData: FormData,
): Promise<AdminLoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) {
    return { error: 'Enter your email and password.' }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: 'That email and password combination is not correct.' }
  }

  const admin = await getAdminContext()
  if (!admin) {
    await supabase.auth.signOut()
    return { error: 'That account does not have platform access.' }
  }

  redirect('/orgs')
}

export async function adminSignOut() {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
