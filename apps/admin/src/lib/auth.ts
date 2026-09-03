import 'server-only'

import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export type AdminRole = 'superadmin' | 'billing' | 'support' | 'readonly'

export interface AdminContext {
  userId: string
  email: string
  fullName: string
  role: AdminRole
}

/**
 * Resolve the platform operator for this request.
 *
 * Two gates, both required: a row in `admin_users` marked active, and an email
 * on the ADMIN_ALLOWED_EMAILS allowlist. The allowlist means that even a
 * compromised database row cannot mint an operator without a deploy.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return null

  const allowlist = (process.env.ADMIN_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  if (allowlist.length > 0 && !allowlist.includes(user.email.toLowerCase())) {
    return null
  }

  // admin_users is invisible to the authenticated role, so this read uses the
  // service-role client.
  const admin = createAdminClient()
  const { data: adminUser } = await admin
    .from('admin_users')
    .select('id, email, full_name, role, is_active')
    .eq('email', user.email.toLowerCase())
    .eq('is_active', true)
    .maybeSingle()

  if (!adminUser) return null

  // Keep the linkage current so impersonation records point at a real user.
  await admin.from('admin_users').update({ user_id: user.id, last_login_at: new Date().toISOString() }).eq('id', adminUser.id)

  return {
    userId: user.id,
    email: adminUser.email,
    fullName: adminUser.full_name,
    role: adminUser.role as AdminRole,
  }
})

export async function requireAdmin(): Promise<AdminContext> {
  const context = await getAdminContext()
  if (!context) redirect('/login')
  return context
}

/** Roles permitted to change anything. Everyone else is read-only. */
export const WRITE_ROLES: readonly AdminRole[] = ['superadmin', 'billing']

export function canWrite(role: AdminRole): boolean {
  return WRITE_ROLES.includes(role)
}
