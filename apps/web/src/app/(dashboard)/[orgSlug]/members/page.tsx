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

/** The design's five tracks, shared by the header and every row. */
const MEMBER_GRID = 'grid-cols-[1.6fr_1.3fr_0.9fr_1.1fr_0.8fr] gap-3.5'

export default async function MembersPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const [{ data: members }, { data: workspaces }, { data: emails }, { data: memberships }] =
    await Promise.all([
    supabase
      .from('org_members')
      .select(
        'user_id, role, joined_at, profile:profiles!org_members_user_id_fkey(id, full_name, avatar_url)',
      )
      .eq('organization_id', auth.orgId)
      .order('joined_at'),
    supabase
      .from('workspaces')
      .select('id, name')
      .eq('organization_id', auth.orgId)
      .order('name'),
    // auth.users is not readable by `authenticated`; this function bridges it
    // for manager-and-above within their own tenant (migration 00038).
    supabase.rpc('org_member_emails'),
    supabase
      .from('workspace_members')
      .select('user_id, workspace:workspaces!workspace_members_workspace_id_fkey(name)')
      .eq('organization_id', auth.orgId),
  ])

  const emailByUser = new Map((emails ?? []).map((row) => [row.user_id, row.email]))

  const workspacesByUser = new Map<string, string[]>()
  for (const row of memberships ?? []) {
    const workspace = Array.isArray(row.workspace) ? row.workspace[0] : row.workspace
    if (!workspace) continue
    const list = workspacesByUser.get(row.user_id) ?? []
    list.push(workspace.name)
    workspacesByUser.set(row.user_id, list)
  }

  const rows = (members ?? []).map((row) => {
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    return {
      userId: row.user_id,
      role: row.role as OrgRole,
      joinedAt: row.joined_at,
      fullName: profile?.full_name ?? 'Unknown',
      avatarUrl: profile?.avatar_url ?? null,
      email: emailByUser.get(row.user_id) ?? null,
      workspaces: (workspacesByUser.get(row.user_id) ?? []).join(', '),
    }
  })

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Members' }]} />

      <SectionHeader
        title="Members"
        count={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`}
      >
        <InviteDialog
          orgSlug={params.orgSlug}
          actorRole={auth.orgRole}
          workspaces={workspaces ?? []}
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
          <span>Workspaces</span>
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

            <span className="text-muted-foreground truncate text-ui">
              {member.workspaces || '—'}
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
              />
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
