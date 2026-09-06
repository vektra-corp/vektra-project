import { publicIdToString } from '@pm/shared/utils'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Authenticated shell for one organization.
 *
 * Membership was already verified in middleware; this re-resolves the org
 * because a layout must not trust a value it did not read itself, and because
 * the org record is needed for the sidebar regardless.
 *
 * The section header lives with each section rather than here: only the layout
 * that owns a route knows its own breadcrumb.
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

  const [
    { data: organization },
    { data: workspaces },
    { data: profile },
    { count: inboxCount },
    { count: myTaskCount },
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, slug, logo_url, status, trial_ends_at, plan:plans!organizations_plan_id_fkey(name, display_name)')
      .eq('slug', params.orgSlug)
      .maybeSingle(),
    supabase
      .from('workspaces')
      .select('id, name, slug, color, icon')
      .eq('organization_id', auth.orgId)
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', auth.userId)
      .maybeSingle(),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .eq('is_read', false),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assignee_id', auth.userId)
      .not('status', 'in', '(done,cancelled)'),
  ])

  if (!organization) notFound()

  // Projects feed the sidebar's expandable per-project view list. RLS already
  // limits this to projects the viewer can open.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, public_id, name, workspace:workspaces!projects_workspace_id_fkey(slug)')
    .eq('organization_id', auth.orgId)
    .eq('status', 'active')
    .order('name')
    .limit(50)

  const sidebarProjects = (projects ?? [])
    .map((project) => {
      const workspace = Array.isArray(project.workspace) ? project.workspace[0] : project.workspace
      // The sidebar builds hrefs, so it gets the public id — never the uuid.
      return workspace
        ? {
            id: publicIdToString(project.public_id),
            name: project.name,
            workspace_slug: workspace.slug,
            color: null,
          }
        : null
    })
    .filter((project): project is NonNullable<typeof project> => project !== null)

  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <Sidebar
        orgSlug={params.orgSlug}
        orgName={organization.name}
        orgRole={auth.orgRole}
        workspaces={workspaces ?? []}
        projects={sidebarProjects}
        profile={profile ?? { id: auth.userId, full_name: '', avatar_url: null }}
        inboxCount={inboxCount ?? 0}
        myTaskCount={myTaskCount ?? 0}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  )
}
