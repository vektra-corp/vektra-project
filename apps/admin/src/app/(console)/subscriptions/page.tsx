import { formatDate } from '@pm/shared/utils'
import { Badge, DataTable, type DataTableColumn } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Subscriptions' }

interface Row {
  id: string
  name: string
  status: string
  planName: string
  seats: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  trialEndsAt: string | null
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'critical' }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="label-meta text-faint">{label}</p>
      <p
        className={`pt-2.5 text-xl font-semibold tabular-nums ${
          tone === 'critical' && value > 0 ? 'text-destructive' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

/**
 * Subscription state per tenant.
 *
 * Seats are counted from `org_members` rather than read from Stripe: this page
 * answers "what does the product think it is billing for", which is the number
 * that drifts and therefore the one worth watching.
 */
export default async function SubscriptionsPage() {
  await requireAdmin()
  const supabase = createAdminClient()

  const [{ data: organizations }, { data: members }] = await Promise.all([
    supabase
      .from('organizations')
      .select(
        'id, name, status, trial_ends_at, stripe_customer_id, stripe_subscription_id, plan:plans(display_name)',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('org_members').select('organization_id'),
  ])

  const seats = new Map<string, number>()
  for (const member of members ?? []) {
    seats.set(member.organization_id, (seats.get(member.organization_id) ?? 0) + 1)
  }

  const rows: Row[] = (organizations ?? []).map((org) => {
    const plan = Array.isArray(org.plan) ? org.plan[0] : org.plan
    return {
      id: org.id,
      name: org.name,
      status: org.status,
      planName: plan?.display_name ?? '—',
      seats: seats.get(org.id) ?? 0,
      stripeCustomerId: org.stripe_customer_id,
      stripeSubscriptionId: org.stripe_subscription_id,
      trialEndsAt: org.trial_ends_at,
    }
  })

  const paying = rows.filter((row) => row.stripeSubscriptionId).length
  const trialing = rows.filter((row) => row.status === 'trial').length
  // A tenant marked active with no Stripe subscription is billing drift: it is
  // being served without anything to invoice against.
  const unlinked = rows.filter((row) => row.status === 'active' && !row.stripeSubscriptionId).length

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'org',
      header: 'Organization',
      cell: (row) => (
        <Link href={`/orgs/${row.id}`} className="text-[13px] transition-colors hover:text-primary">
          {row.name}
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
      key: 'seats',
      header: 'Seats',
      headClassName: 'w-20',
      cell: (row) => <span className="label-meta tabular-nums text-faint">{row.seats}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      headClassName: 'w-28',
      cell: (row) => (
        <Badge variant={row.status === 'active' ? 'success' : 'outline'} shape="meta">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'stripe',
      header: 'Stripe',
      headClassName: 'w-40',
      cell: (row) =>
        row.stripeSubscriptionId ? (
          <span className="font-mono text-[10px] text-faint">{row.stripeSubscriptionId}</span>
        ) : (
          <Badge variant="warning" shape="meta">
            Not linked
          </Badge>
        ),
    },
    {
      key: 'trial',
      header: 'Trial ends',
      headClassName: 'w-32',
      cell: (row) => (
        <span className="label-meta text-faint">
          {row.trialEndsAt
            ? formatDate(row.trialEndsAt, { locale: 'en', dateFormat: 'YYYY-MM-DD' })
            : '—'}
        </span>
      ),
    },
  ]

  return (
    <>
      <AdminHeader title="Subscriptions" description="Billing state as the product understands it." />
      <AdminBody>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="With a subscription" value={paying} />
            <Stat label="In trial" value={trialing} />
            <Stat label="Active, unlinked" value={unlinked} tone="critical" />
          </div>
          <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} empty="No tenants." />
        </div>
      </AdminBody>
    </>
  )
}
