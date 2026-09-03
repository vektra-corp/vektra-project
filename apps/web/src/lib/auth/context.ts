import 'server-only'

import type { AuthContext } from '@pm/auth'
import { parseCustomPermissions } from '@pm/auth/rbac'
import type { OrgRole } from '@pm/shared/constants'
import { appError } from '@pm/shared/errors'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Tenant context for the current request, including the organization metadata
 * that pages would otherwise re-query.
 */
export interface RequestContext extends AuthContext {
  orgSlug: string
  orgTimezone: string
  orgCurrency: string
  orgStatus: string
  planName: string | null
}

/**
 * Resolve the authenticated principal for the current request.
 *
 * RULE (§13.5): auth.getUser() is called in EVERY server action and API route —
 * it revalidates against the auth server, unlike getSession() which only reads a
 * forgeable cookie.
 *
 * Everything else comes from one `current_auth_context` RPC. Against a hosted
 * database each round trip costs ~240ms, so the previous three sequential calls
 * (getUser, org_members, roles) cost most of a second on every layout, page and
 * action. The org role is still read live rather than from the JWT, so a revoked
 * role takes effect immediately instead of at the next token refresh.
 *
 * Wrapped in React's `cache` so every component in one render shares the result.
 */
export const getAuthContext = cache(async (orgSlug?: string): Promise<RequestContext | null> => {
  const supabase = createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .rpc('current_auth_context', { p_org_slug: orgSlug ?? undefined })
    .maybeSingle()

  const context = data as {
    organization_id: string
    org_role: string
    org_slug: string
    org_timezone: string
    org_currency: string
    org_status: string
    plan_name: string | null
    permissions: unknown
  } | null

  if (!context) return null

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: context.organization_id,
    orgRole: context.org_role as OrgRole,
    orgSlug: context.org_slug,
    orgTimezone: context.org_timezone,
    orgCurrency: context.org_currency,
    orgStatus: context.org_status,
    planName: context.plan_name,
    customPermissions: parseCustomPermissions(context.permissions),
    mfaVerified: user.factors?.some((factor) => factor.status === 'verified') ?? false,
  }
})

/** Same as getAuthContext but throws instead of returning null. For actions. */
export async function requireAuth(orgSlug?: string): Promise<RequestContext> {
  const context = await getAuthContext(orgSlug)
  if (!context) throw appError('UNAUTHORIZED', 'Not signed in')
  return context
}

/** Same as requireAuth but redirects instead of throwing. For pages. */
export async function requireAuthPage(orgSlug?: string): Promise<RequestContext> {
  const context = await getAuthContext(orgSlug)
  if (!context) redirect('/login')
  return context
}
