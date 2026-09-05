import { ORG_MANAGER_ROLES, ORG_ROLE_LABELS } from '@pm/auth/constants'
import type { OrgRole } from '@pm/shared/constants'
import { formatRelativeTime, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge } from '@pm/ui'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { InviteDialog } from './invite-dialog'
import { MemberRowActions } from './member-row-actions'

export const metadata: Metadata = { title: 'Members' }

const ROLE_BADGE: Record<OrgRole, 'default' | 'secondary' | 'success' | 'outline'> = {
  owner: 'default',
  admin: 'success',
  manager: 'outline',
  member: 'secondary',
}

export default async function MembersPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const [{ data: members }, { data: workspaces }] = await Promise.all([
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
  ])

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
    }
  })

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'Members' }]}
        meta={
          <Badge variant="secondary" shape="meta" className="ms-1">
            {rows.length} people
          </Badge>
        }
      />

      <PageBody className="pt-2">
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-base text-muted-foreground">
              Everyone with access to this organization.
            </p>
            <InviteDialog
              orgSlug={params.orgSlug}
              actorRole={auth.orgRole}
              workspaces={workspaces ?? []}
            />
          </div>

          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {rows.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
                <Avatar className="h-8 w-8">
                  {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="bg-surface-hover text-[10px] font-medium uppercase text-muted-foreground">
                    {initials(member.fullName)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-base font-medium">
                    <span className="truncate">{member.fullName}</span>
                    {member.userId === auth.userId ? (
                      <Badge variant="secondary" shape="meta">
                        You
                      </Badge>
                    ) : null}
                  </p>
                  <p className="label-meta pt-1 text-faint">
                    Joined {formatRelativeTime(member.joinedAt, locale)}
                  </p>
                </div>

                <Badge variant={ROLE_BADGE[member.role]} shape="meta">
                  {ORG_ROLE_LABELS[member.role]}
                </Badge>

                <MemberRowActions
                  orgSlug={params.orgSlug}
                  actorRole={auth.orgRole}
                  member={member}
                  isSelf={member.userId === auth.userId}
                />
              </li>
            ))}
          </ul>
        </div>
      </PageBody>
    </>
  )
}
