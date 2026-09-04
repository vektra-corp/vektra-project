import { Badge, DataTable, type DataTableColumn } from '@pm/ui'
import { format } from 'date-fns'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Audit logs' }

interface Row {
  id: string
  action: string
  actorType: string
  resourceType: string
  resourceId: string | null
  createdAt: string
  orgId: string
  orgName: string
}

const ACTOR_VARIANT: Record<string, 'secondary' | 'warning' | 'outline'> = {
  user: 'secondary',
  admin: 'warning',
  system: 'outline',
  workflow: 'outline',
  integration: 'outline',
}

/** Immutable trail across every tenant (§13.11). Newest first. */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: { org?: string }
}) {
  await requireAdmin()
  const supabase = createAdminClient()

  let query = supabase
    .from('audit_logs')
    .select(
      'id, action, actor_type, resource_type, resource_id, created_at, organization_id, organization:organizations!audit_logs_organization_id_fkey(name)',
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (searchParams.org) query = query.eq('organization_id', searchParams.org)

  const { data: logs } = await query

  const rows: Row[] = (logs ?? []).map((log) => {
    const org = Array.isArray(log.organization) ? log.organization[0] : log.organization
    return {
      id: log.id,
      action: log.action,
      actorType: log.actor_type,
      resourceType: log.resource_type,
      resourceId: log.resource_id,
      createdAt: log.created_at,
      orgId: log.organization_id,
      orgName: org?.name ?? 'Unknown',
    }
  })

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'when',
      header: 'When',
      headClassName: 'w-40',
      cell: (row) => (
        <span className="label-meta text-faint">
          {format(new Date(row.createdAt), 'yyyy-MM-dd HH:mm')}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => <span className="font-mono text-xs">{row.action}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      headClassName: 'w-28',
      cell: (row) => (
        <Badge variant={ACTOR_VARIANT[row.actorType] ?? 'secondary'} shape="meta">
          {row.actorType}
        </Badge>
      ),
    },
    {
      key: 'org',
      header: 'Organization',
      headClassName: 'w-48',
      cell: (row) => (
        <Link
          href={`/orgs/${row.orgId}`}
          className="truncate text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {row.orgName}
        </Link>
      ),
    },
    {
      key: 'resource',
      header: 'Resource',
      headClassName: 'w-32',
      cell: (row) => (
        <span className="label-meta text-faint">{row.resourceType}</span>
      ),
    },
  ]

  return (
    <>
      <AdminHeader
        title="Audit logs"
        description={
          searchParams.org
            ? 'Filtered to one organization.'
            : 'Newest 200 entries across all tenants.'
        }
        actions={
          searchParams.org ? (
            <Link
              href="/audit-logs"
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear filter
            </Link>
          ) : null
        }
      />
      <AdminBody>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty="Nothing logged yet." />
      </AdminBody>
    </>
  )
}
