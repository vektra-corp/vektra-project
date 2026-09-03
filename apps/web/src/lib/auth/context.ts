import 'server-only'

import type { AuthContext } from '@pm/auth'
import { parseCustomPermissions } from '@pm/auth/rbac'
import type { OrgRole } from '@pm/shared/constants'
import { appError } from '@pm/shared/errors'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Resolve the authenticated principal for the current request.
 *
 * RULE (§13.5): auth.getUser() is called in EVERY server action and API route.
 * Nothing here trusts a client-supplied identity, and the org role is read from
 * the membership table rather than the JWT so a revoked role takes effect
 * immediately instead of at the next token refresh.
 *
 * Wrapped in React's `cache` so several server components in one render share a
 * single round trip.
 */
export const getAuthContext = cache(async (orgSlug?: string): Promise<AuthContext | null> => {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const query = supabase
    .from('org_members')
    .select('organization_id, role, organizations!inner(slug)')
    .eq('user_id', user.id)

  const { data: membership } = orgSlug
    ? await query.eq('organizations.slug', orgSlug).maybeSingle()
    : await query.order('is_default', { ascending: false }).limit(1).maybeSingle()

  if (!membership) return null

  // Enterprise custom roles can narrow (never widen beyond) the system matrix.
  const { data: customRole } = await supabase
    .from('roles')
    .select('permissions')
    .eq('organization_id', membership.organization_id)
    .eq('name', membership.role)
    .maybeSingle()

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: membership.organization_id,
    orgRole: membership.role as OrgRole,
    customPermissions: parseCustomPermissions(customRole?.permissions),
    mfaVerified: user.factors?.some((factor) => factor.status === 'verified') ?? false,
  }
})

/** Same as getAuthContext but throws instead of returning null. For actions. */
export async function requireAuth(orgSlug?: string): Promise<AuthContext> {
  const context = await getAuthContext(orgSlug)
  if (!context) throw appError('UNAUTHORIZED', 'Not signed in')
  return context
}

/** Same as requireAuth but redirects instead of throwing. For pages. */
export async function requireAuthPage(orgSlug?: string): Promise<AuthContext> {
  const context = await getAuthContext(orgSlug)
  if (!context) redirect('/login')
  return context
}
