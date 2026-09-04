import 'server-only'

import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Portal context for the current request.
 *
 * An external user has a `portal_users` row but no `org_members` row, so they
 * carry no `org_id` claim and every org-scoped RLS policy denies them by
 * default. Their access comes solely from `portal_project_access` — the
 * allowlist described in §18 rule 6. If a row is not there, they see nothing.
 */
export interface PortalContext {
  portalUserId: string
  userId: string
  orgId: string
  orgSlug: string
  orgName: string
  fullName: string
  email: string
}

export const getPortalContext = cache(
  async (orgSlug: string): Promise<PortalContext | null> => {
    const supabase = createClient()

    // §13.5: getUser() revalidates against the auth server. getSession() reads a
    // forgeable cookie and must never gate access.
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null

    const { data } = await supabase
      .from('portal_users')
      .select(
        'id, email, full_name, organization_id, organization:organizations!portal_users_organization_id_fkey(slug, name)',
      )
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (!data) return null

    const organization = Array.isArray(data.organization) ? data.organization[0] : data.organization
    // A portal account belongs to exactly one organization; refuse if the URL
    // names a different one rather than silently showing the wrong tenant.
    if (!organization || organization.slug !== orgSlug) return null

    return {
      portalUserId: data.id,
      userId: user.id,
      orgId: data.organization_id,
      orgSlug: organization.slug,
      orgName: organization.name,
      fullName: data.full_name,
      email: data.email,
    }
  },
)

/** Same as getPortalContext but redirects instead of returning null. */
export async function requirePortal(orgSlug: string): Promise<PortalContext> {
  const context = await getPortalContext(orgSlug)
  if (!context) redirect('/403')
  return context
}
