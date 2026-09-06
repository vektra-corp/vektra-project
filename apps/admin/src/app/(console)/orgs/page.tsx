import { formatDate } from '@pm/shared/utils'
import { Badge, DataTable, type DataTableColumn } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Organizations' }

interface Row {
  id: string
  name: string
  slug: string
  status: string
  created_at: string
  trial_ends_at: string | null
  planName: string
}

const STATUS_VARIANT: Record<string, 'success' | 'outline' | 'destructive' | 'secondary'> = {
  active: 'success',
  trial: 'outline',
  suspended: 'destructive',
  churned: 'secondary',
}

/**
 * Tenant list.
 *
 * Reads through the service-role client, so it deliberately selects only the
 * operational columns an operator needs — never customer content.
 */
export default async function OrgsPage() {
  await requireAdmin()
  const supabase = createAdminClient()

  const { data: organizations } = await supabase
    .from('organizations')
    .select('id, name, slug, status, created_at, trial_ends_at, plan:plans!organizations_plan_id_fkey(display_name)')
    .order('created_at', { ascending: false })
    .limit(100)

  const rows: Row[] = (organizations ?? []).map((org) => {
    const plan = Array.isArray(org.plan) ? org.plan[0] : org.plan
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      created_at: org.created_at,
      trial_ends_at: org.trial_ends_at,
      planName: plan?.display_name ?? '—',
    }
  })

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'name',
      header: 'Organization',
      cell: (row) => (
        <Link
          href={`/orgs/${row.id}`}
          className="text-[13px] font-medium transition-colors hover:text-primary"
        >
          {row.name}
          <span className="ps-2 font-mono text-[10px] text-faint">/{row.slug}</span>
        </Link>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      headClassName: 'w-28',
      cell: (row) => <span className="text-[13px] text-muted-foreground">{row.planName}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      headClassName: 'w-28',
      cell: (row) => (
        <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'} shape="meta">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'trial',
      header: 'Trial ends',
      headClassName: 'w-32',
      cell: (row) => (
        <span className="label-meta text-faint">
          {row.trial_ends_at
            ? formatDate(row.trial_ends_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })
            : '—'}
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Created',
      headClassName: 'w-32',
      cell: (row) => (
        <span className="label-meta text-faint">
          {formatDate(row.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
        </span>
      ),
    },
  ]

  return (
    <>
      <AdminHeader
        title="Organizations"
        description={`${rows.length} tenants, newest first.`}
      />
      <AdminBody>
        <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty="No tenants yet." />
      </AdminBody>
    </>
  )
}
