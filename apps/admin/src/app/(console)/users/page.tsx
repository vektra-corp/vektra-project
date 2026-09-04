import { formatDate, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Badge, DataTable, type DataTableColumn } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Users' }

interface Row {
  id: string
  fullName: string
  createdAt: string
  memberships: { orgId: string; orgName: string; role: string }[]
}

/** People across every tenant, with the organizations they belong to. */
export default async function UsersPage() {
  await requireAdmin()
  const supabase = createAdminClient()

  const [{ data: profiles }, { data: memberships }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('org_members')
      .select('user_id, role, organization:organizations!org_members_organization_id_fkey(id, name)'),
  ])

  const byUser = new Map<string, Row['memberships']>()
  for (const row of memberships ?? []) {
    const org = Array.isArray(row.organization) ? row.organization[0] : row.organization
    if (!org) continue
    const list = byUser.get(row.user_id) ?? []
    list.push({ orgId: org.id, orgName: org.name, role: row.role })
    byUser.set(row.user_id, list)
  }

  const rows: Row[] = (profiles ?? []).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    createdAt: profile.created_at,
    memberships: byUser.get(profile.id) ?? [],
  }))

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: 'Person',
      cell: (row) => (
        <span className="flex items-center gap-2.5">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-surface-hover text-[9px] font-medium uppercase text-muted-foreground">
              {initials(row.fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-[13px]">{row.fullName}</span>
        </span>
      ),
    },
    {
      key: 'orgs',
      header: 'Organizations',
      cell: (row) =>
        row.memberships.length === 0 ? (
          <span className="label-meta text-faint">None</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.memberships.map((membership) => (
              <Link key={membership.orgId} href={`/orgs/${membership.orgId}`}>
                <Badge variant="secondary" shape="meta">
                  {membership.orgName}
                  <span className="opacity-60">· {membership.role}</span>
                </Badge>
              </Link>
            ))}
          </span>
        ),
    },
    {
      key: 'created',
      header: 'Joined',
      headClassName: 'w-32',
      cell: (row) => (
        <span className="label-meta text-faint">
          {formatDate(row.createdAt, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
        </span>
      ),
    },
  ]

  return (
    <>
      <AdminHeader title="Users" description="Newest 100 accounts across all tenants." />
      <AdminBody>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty="No users yet." />
      </AdminBody>
    </>
  )
}
