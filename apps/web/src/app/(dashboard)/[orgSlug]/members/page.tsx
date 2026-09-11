import { ORG_MANAGER_ROLES, ORG_ROLE_LABELS } from '@pm/auth/constants'
import type { OrgRole } from '@pm/shared/constants'
import { formatRelativeTime, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge, cn } from '@pm/ui'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { SectionHeader } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import type { PickerProject, PickerWorkspace } from './access-picker'
import { InviteDialog } from './invite-dialog'
import { MemberRowActions } from './member-row-actions'

export const metadata: Metadata = { title: 'Members' }

/**
 * Role colour, carried on the text over one neutral chip.
 *
 * The design tints the label rather than the fill: four differently tinted
 * pills in a column read as four different row states, which is not what a role
 * is.
 */
const ROLE_TONE: Record<OrgRole, string> = {
  owner: 'text-primary',
  admin: 'text-status-review',
  manager: 'text-muted-foreground',
  member: 'text-muted-foreground',
}

/**
 * Six tracks: the five the design had, plus access.
 *
 * Access earns a column because it is the answer to the question the screen is
 * usually open to settle — "why can this person not see the project?" — and it
 * was previously invisible.
 */
const MEMBER_GRID = 'grid-cols-[1.5fr_1.3fr_0.8fr_0.7fr_1.2fr_0.7fr] gap-3.5'

export default async function MembersPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const [
    { data: members },
    { data: workspaces },
    { data: directory },
    { data: workspaceMemberships },
    { data: projects },
    { data: projectMemberships },
  ] = await Promise.all([
    supabase
      .from('org_members')
      .select(
        'user_id, role, joined_at, profile:profiles!org_members_user_id_fkey(id, full_name, avatar_url)',
      )
      .eq('organization_id', auth.orgId)
      .order('joined_at'),
    supabase.from('workspaces').select('id, name').eq('organization_id', auth.orgId).order('name'),
    // auth.users is not readable by `authenticated`; this function bridges it
    // for manager-and-above within their own tenant (migration 00042).
    supabase.rpc('org_member_directory'),
    supabase
      .from('workspace_members')
      .select('user_id, workspace_id')
      .eq('organization_id', auth.orgId),
    supabase
      .from('projects')
      .select('id, name, workspace_id')
      .eq('organization_id', auth.orgId)
      .neq('status', 'archived')
      .order('name'),
    supabase
      .from('project_members')
      .select('user_id, project_id')
      .eq('organization_id', auth.orgId),
  ])

  const directoryByUser = new Map((directory ?? []).map((row) => [row.user_id, row]))

  const workspaceIdsByUser = new Map<string, string[]>()
  for (const row of workspaceMemberships ?? []) {
    workspaceIdsByUser.set(row.user_id, [
      ...(workspaceIdsByUser.get(row.user_id) ?? []),
      row.workspace_id,
    ])
  }

  const projectIdsByUser = new Map<string, string[]>()
  for (const row of projectMemberships ?? []) {
    projectIdsByUser.set(row.user_id, [
      ...(projectIdsByUser.get(row.user_id) ?? []),
      row.project_id,
    ])
  }

  const workspaceNames = new Map((workspaces ?? []).map((row) => [row.id, row.name]))
  const projectNames = new Map((projects ?? []).map((row) => [row.id, row.name]))

  const pickerWorkspaces: PickerWorkspace[] = (workspaces ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }))

  const pickerProjects: PickerProject[] = (projects ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
  }))

  const rows = (members ?? []).map((row) => {
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    const entry = directoryByUser.get(row.user_id)
    const memberWorkspaceIds = workspaceIdsByUser.get(row.user_id) ?? []
    const memberProjectIds = projectIdsByUser.get(row.user_id) ?? []

    return {
      userId: row.user_id,
      role: row.role as OrgRole,
      joinedAt: row.joined_at,
      fullName: profile?.full_name ?? 'Unknown',
      avatarUrl: profile?.avatar_url ?? null,
      email: entry?.email ?? null,
      // Absent from the directory means the row could not be joined to an auth
      // user at all; treating that as pending is the fail-closed reading.
      status: entry?.status === 'active' ? ('active' as const) : ('pending' as const),
      workspaceIds: memberWorkspaceIds,
      projectIds: memberProjectIds,
      accessLabel:
        memberProjectIds.length > 0
          ? memberProjectIds
              .map((id) => projectNames.get(id))
              .filter(Boolean)
              .join(', ')
          : memberWorkspaceIds
              .map((id) => workspaceNames.get(id))
              .filter(Boolean)
              .join(', '),
      accessKind: memberProjectIds.length > 0 ? ('project' as const) : ('workspace' as const),
    }
  })

  const pendingCount = rows.filter((row) => row.status === 'pending').length

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Members' }]} />

      <SectionHeader
        title="Members"
        count={
          pendingCount > 0
            ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${pendingCount} invited`
            : `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`
        }
      >
        <InviteDialog
          orgSlug={params.orgSlug}
          actorRole={auth.orgRole}
          workspaces={pickerWorkspaces}
          projects={pickerProjects}
        />
      </SectionHeader>

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            MEMBER_GRID,
            'border-border label-meta-lg text-subtle grid border-b px-5 py-2.5',
          )}
        >
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Status</span>
          <span>Access</span>
          <span>Joined</span>
        </div>

        {rows.map((member) => (
          <div
            key={member.userId}
            className={cn(MEMBER_GRID, 'border-border grid items-center border-b px-5 py-3')}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Avatar className="h-[26px] w-[26px] shrink-0">
                {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-chip text-muted-foreground text-[10px] font-semibold uppercase">
                  {initials(member.fullName)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-task font-medium">{member.fullName}</span>
              {member.userId === auth.userId ? (
                <Badge variant="secondary" shape="meta" className="shrink-0">
                  You
                </Badge>
              ) : null}
            </span>

            <span className="text-muted-foreground truncate text-ui">{member.email ?? '—'}</span>

            <span
              className={cn(
                'bg-chip justify-self-start rounded-[5px] px-2 py-[3px] text-[11px] font-semibold uppercase',
                ROLE_TONE[member.role],
              )}
            >
              {ORG_ROLE_LABELS[member.role]}
            </span>

            <span
              className={cn(
                'justify-self-start rounded-[5px] px-2 py-[3px] text-[11px] font-semibold uppercase',
                member.status === 'pending'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-chip text-muted-foreground',
              )}
            >
              {member.status === 'pending' ? 'Invited' : 'Active'}
            </span>

            <span className="text-muted-foreground min-w-0 truncate text-ui">
              {member.accessLabel ? (
                <>
                  {member.accessKind === 'workspace' ? (
                    <span className="text-faint">Workspace only · </span>
                  ) : null}
                  {member.accessLabel}
                </>
              ) : (
                <span className="text-warning">No access</span>
              )}
            </span>

            <span className="flex items-center gap-2">
              <span className="text-faint font-mono text-[10.5px] tabular-nums">
                {formatRelativeTime(member.joinedAt, locale)}
              </span>
              <MemberRowActions
                orgSlug={params.orgSlug}
                actorRole={auth.orgRole}
                member={member}
                isSelf={member.userId === auth.userId}
                workspaces={pickerWorkspaces}
                projects={pickerProjects}
              />
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
