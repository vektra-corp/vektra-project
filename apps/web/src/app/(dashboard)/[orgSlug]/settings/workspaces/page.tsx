import { canCreateWorkspace, isAtLeast } from '@pm/auth/rbac'
import { resolveOrgPolicy } from '@pm/shared/constants'
import type { Metadata } from 'next'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { WorkspaceDelegation } from './workspace-delegation'
import { WorkspaceManager, type WorkspaceRow } from './workspace-manager'

export const metadata: Metadata = { title: 'Workspaces' }

export default async function WorkspacesSettingsPage({
  params,
}: {
  params: { orgSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: workspaces }, { data: projects }, { data: members }, { data: organization }] =
    await Promise.all([
    supabase
      .from('workspaces')
      .select('id, name, slug, description, color')
      .eq('organization_id', auth.orgId)
      .order('name'),
    // Counted in memory rather than with a correlated subquery per row: both
    // lists are small and this is one round trip instead of N.
    supabase.from('projects').select('workspace_id').eq('organization_id', auth.orgId),
    supabase.from('workspace_members').select('workspace_id').eq('organization_id', auth.orgId),
    supabase.from('organizations').select('settings').eq('id', auth.orgId).maybeSingle(),
  ])

  const policy = resolveOrgPolicy(organization?.settings)

  const projectCounts = new Map<string, number>()
  for (const project of projects ?? []) {
    projectCounts.set(project.workspace_id, (projectCounts.get(project.workspace_id) ?? 0) + 1)
  }

  const memberCounts = new Map<string, number>()
  for (const member of members ?? []) {
    memberCounts.set(member.workspace_id, (memberCounts.get(member.workspace_id) ?? 0) + 1)
  }

  const rows: WorkspaceRow[] = (workspaces ?? []).map((workspace) => ({
    ...workspace,
    project_count: projectCounts.get(workspace.id) ?? 0,
    member_count: memberCounts.get(workspace.id) ?? 0,
  }))

  return (
    <SettingsPanel>
      <WorkspaceManager
        orgSlug={params.orgSlug}
        workspaces={rows}
        // Not `projects.create`: creating a workspace is an admin power unless
        // this org has delegated it. Same predicate the RLS policy applies, so
        // the button is never offered for a write the database will refuse.
        canManage={canCreateWorkspace(auth.orgRole, policy.managersCanCreateWorkspaces)}
      />

      {isAtLeast(auth.orgRole, 'admin') ? (
        <WorkspaceDelegation
          orgSlug={params.orgSlug}
          enabled={policy.managersCanCreateWorkspaces}
        />
      ) : null}
    </SettingsPanel>
  )
}
