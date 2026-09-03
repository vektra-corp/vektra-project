import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Authenticated shell for one organization.
 *
 * Membership was already verified in middleware; this re-resolves the org
 * because a layout must not trust a value it did not read itself, and because
 * the org record is needed for the header regardless.
 */
export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { orgSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: organization }, { data: workspaces }, { data: profile }] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, slug, logo_url, status, trial_ends_at, plan:plans(name, display_name)')
      .eq('slug', params.orgSlug)
      .maybeSingle(),
    supabase
      .from('workspaces')
      .select('id, name, slug, color, icon')
      .eq('organization_id', auth.orgId)
      .order('name'),
    supabase.from('profiles').select('id, full_name, avatar_url').eq('id', auth.userId).maybeSingle(),
  ])

  if (!organization) notFound()

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar
        orgSlug={params.orgSlug}
        orgName={organization.name}
        orgRole={auth.orgRole}
        workspaces={workspaces ?? []}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          orgSlug={params.orgSlug}
          organization={organization}
          profile={profile ?? { id: auth.userId, full_name: '', avatar_url: null }}
        />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
