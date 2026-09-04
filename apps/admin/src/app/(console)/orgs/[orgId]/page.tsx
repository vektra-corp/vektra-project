import { formatDate } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'Organization' }

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="label-meta text-faint">{label}</p>
      <p className="pt-2.5 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/**
 * One tenant, from the operator's side.
 *
 * Shows shape and volume — how many projects, how much is stored — never the
 * content of any of it. An operator who needs to see inside a tenant does it
 * through impersonation, which is audited (§13.11).
 */
export default async function OrgDetailPage({ params }: { params: { orgId: string } }) {
  await requireAdmin()
  const supabase = createAdminClient()

  const { data: organization } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, status, created_at, trial_ends_at, billing_email, currency, timezone, stripe_customer_id, plan:plans(display_name, name)',
    )
    .eq('id', params.orgId)
    .maybeSingle()

  if (!organization) notFound()

  const plan = Array.isArray(organization.plan) ? organization.plan[0] : organization.plan

  const [{ count: members }, { count: projects }, { count: tasks }, { count: workspaces }] =
    await Promise.all([
      supabase
        .from('org_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', params.orgId),
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', params.orgId),
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', params.orgId),
      supabase
        .from('workspaces')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', params.orgId),
    ])

  const facts: [string, string][] = [
    ['Slug', organization.slug],
    ['Plan', plan?.display_name ?? '—'],
    ['Billing email', organization.billing_email ?? '—'],
    ['Currency', organization.currency],
    ['Timezone', organization.timezone],
    ['Stripe customer', organization.stripe_customer_id ?? 'Not linked'],
    ['Created', formatDate(organization.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })],
    [
      'Trial ends',
      organization.trial_ends_at
        ? formatDate(organization.trial_ends_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })
        : '—',
    ],
  ]

  return (
    <>
      <AdminHeader
        title={organization.name}
        description="Operational view. Tenant content is not shown here."
        actions={
          <>
            <Badge variant={organization.status === 'active' ? 'success' : 'outline'} shape="meta">
              {organization.status}
            </Badge>
            <Link
              href="/orgs"
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Back
            </Link>
          </>
        }
      />

      <AdminBody>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Members" value={members ?? 0} />
            <Stat label="Workspaces" value={workspaces ?? 0} />
            <Stat label="Projects" value={projects ?? 0} />
            <Stat label="Tasks" value={tasks ?? 0} />
          </div>

          <dl className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {facts.map(([label, value], index) => (
              <div
                key={label}
                className={`flex items-center justify-between gap-4 px-4 py-2.5 ${index > 0 ? 'border-t border-border-subtle' : ''}`}
              >
                <dt className="label-meta text-faint">{label}</dt>
                <dd className="truncate font-mono text-xs">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </AdminBody>
    </>
  )
}
