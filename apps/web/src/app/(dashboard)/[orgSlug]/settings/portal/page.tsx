import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { limitFor } from '@pm/shared/billing'
import type { Metadata } from 'next'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { PortalManager, type PortalUserRow, type ProjectOption } from './portal-manager'

export const metadata: Metadata = { title: 'Portal access' }

export default async function PortalSettingsPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const [{ data: portalUsers }, { data: projects }, { data: grants }] = await Promise.all([
    supabase
      .from('portal_users')
      .select('id, email, full_name, status')
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, name')
      .eq('organization_id', auth.orgId)
      .eq('status', 'active')
      .order('name'),
    supabase
      .from('portal_project_access')
      .select('portal_user_id, project_id')
      .eq('organization_id', auth.orgId),
  ])

  const byUser = new Map<string, string[]>()
  for (const grant of grants ?? []) {
    const list = byUser.get(grant.portal_user_id) ?? []
    list.push(grant.project_id)
    byUser.set(grant.portal_user_id, list)
  }

  const rows: PortalUserRow[] = (portalUsers ?? []).map((user) => ({
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    status: user.status,
    projectIds: byUser.get(user.id) ?? [],
  }))

  const options: ProjectOption[] = projects ?? []

  // Portal seats are a plan limit (§17). Starter has none, so the invite button
  // is disabled rather than failing after the fact.
  const seatLimit = limitFor(auth.entitlements, 'portal_users')

  return (
    <PageBody>
      <div className="max-w-2xl">
        <PortalManager
          orgSlug={params.orgSlug}
          portalUsers={rows}
          projects={options}
          seatLimit={seatLimit}
        />
      </div>
    </PageBody>
  )
}
