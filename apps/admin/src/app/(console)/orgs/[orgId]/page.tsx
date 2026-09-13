import { formatDate } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { compact, shortMoney } from '@/components/chart-format'
import { BarList, StatTile } from '@/components/charts'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { COUNTRY_LABEL } from '../../dashboard-shared'
import { OrgRowMenu } from '../org-row-menu'
import { SubscriptionControls } from './subscription-controls'

export const metadata: Metadata = { title: 'Organization' }

const LIVE = ['pending', 'authenticated', 'active', 'past_due', 'paused']

/**
 * One tenant, from the operator's side.
 *
 * Shows shape, volume and money — never the content of a tenant's work. An
 * operator who needs to see inside a tenant does it through impersonation,
 * which is audited separately (§13.11).
 *
 * "Current pricing" is read from the live subscription rather than the plan
 * catalogue, because `subscriptions.unit_amount_minor` is a SNAPSHOT taken when
 * the subscription started (00037). A catalogue price rise does not change what
 * this customer pays, and showing the catalogue figure here would tell an
 * operator the wrong number during exactly the conversation where it matters.
 */
export default async function OrgDetailPage({ params }: { params: { orgId: string } }) {
  const admin = await requireAdmin()
  const readOnly = !canWrite(admin.role)
  const supabase = createAdminClient()

  const { data: organization } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, status, status_reason, status_changed_at, created_at, trial_ends_at, billing_email, currency, timezone, billing_country, gstin, payment_provider',
    )
    .eq('id', params.orgId)
    .maybeSingle()

  if (!organization) notFound()

  const [
    { count: members },
    { count: projects },
    { count: tasks },
    { count: subtasks },
    { count: workspaces },
    { data: subscriptions },
    { data: payments },
    { data: prices },
    { data: planRows },
  ] = await Promise.all([
    supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('organization_id', params.orgId),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('organization_id', params.orgId),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', params.orgId),
    supabase.from('subtasks').select('id', { count: 'exact', head: true }).eq('organization_id', params.orgId),
    supabase.from('workspaces').select('id', { count: 'exact', head: true }).eq('organization_id', params.orgId),
    supabase
      .from('subscriptions')
      .select(
        'id, provider, provider_subscription_id, status, grant_kind, grant_ends_at, grant_reason, currency, billing_interval, unit_amount_minor, seats, trial_ends_at, current_period_end, cancel_at_period_end, needs_reauthorization, pending_price_id, pending_reason, pending_synced_at, plan:plans!subscriptions_plan_id_fkey(id, display_name, tier), pendingPlan:plans!subscriptions_pending_plan_id_fkey(display_name)',
      )
      .eq('organization_id', params.orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('payments')
      .select('id, status, currency, amount_minor, amount_refunded_minor, method, created_at, captured_at, error_description')
      .eq('organization_id', params.orgId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('plan_prices')
      .select('id, currency, billing_interval, unit_amount_minor, is_active, plan:plans(id, display_name, tier, sort_order, organization_id)')
      .eq('is_active', true),
    // Plans in their own right. A grant is free, so it does not need a price to
    // exist — deriving the grantable list from plan_prices left the "provision
    // without payment" dropdown empty whenever the catalogue had no active
    // price, which is exactly when an operator is most likely to comp someone.
    supabase
      .from('plans')
      .select('id, display_name, sort_order, organization_id, is_active')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  const all = subscriptions ?? []
  const live = all.filter((s) => LIVE.includes(s.status))
  const paid = live.find((s) => s.provider !== 'manual') ?? null
  const grant = live.find((s) => s.provider === 'manual') ?? null
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  /* Revenue for this tenant, per currency — never summed across them. */
  const revenue = new Map<string, number>()
  for (const p of payments ?? []) {
    if (p.status !== 'captured') continue
    revenue.set(p.currency, (revenue.get(p.currency) ?? 0) + p.amount_minor - (p.amount_refunded_minor ?? 0))
  }
  const revenueLabel =
    revenue.size === 0
      ? '—'
      : [...revenue.entries()].map(([c, v]) => shortMoney(v, c)).join(' · ')

  // The catalogue this tenant can be moved onto: shared plans, plus any plan
  // built specifically for them.
  const catalogue = (prices ?? []).filter((row) => {
    const plan = one(row.plan)
    return plan && (!plan.organization_id || plan.organization_id === params.orgId)
  })

  const blocked = organization.status === 'suspended' || organization.status === 'banned'

  const facts: [string, string][] = [
    ['Slug', organization.slug],
    ['Billing email', organization.billing_email ?? '—'],
    ['Billing country', organization.billing_country ? (COUNTRY_LABEL[organization.billing_country] ?? organization.billing_country) : 'Not set'],
    ['GSTIN', organization.gstin ?? '—'],
    ['Gateway', organization.payment_provider ?? 'Not routed yet'],
    ['Currency', organization.currency],
    ['Timezone', organization.timezone],
    ['Created', formatDate(organization.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })],
  ]

  return (
    <>
      <AdminHeader
        title={organization.name}
        description="Operational view. Tenant content is not shown here."
        actions={
          <>
            <Badge
              variant={
                organization.status === 'active'
                  ? 'success'
                  : organization.status === 'banned'
                    ? 'destructive'
                    : organization.status === 'suspended'
                      ? 'warning'
                      : 'outline'
              }
              shape="meta"
            >
              {organization.status}
            </Badge>
            <OrgRowMenu
              orgId={organization.id}
              orgName={organization.name}
              status={organization.status}
              readOnly={readOnly}
            />
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
          {blocked ? (
            <div className="border-destructive/40 bg-destructive/10 rounded-lg border px-4 py-3">
              <p className="text-destructive text-[13px] font-medium">
                Every user in this organization is locked out.
              </p>
              <p className="text-muted-foreground pt-1 text-xs">
                {organization.status_reason
                  ? `Reason shown to them: “${organization.status_reason}”`
                  : 'No reason was recorded.'}
                {organization.status_changed_at
                  ? ` · set ${formatDate(organization.status_changed_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}`
                  : ''}
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatTile label="Total revenue" value={revenueLabel} sub="Captured, less refunds" tone="good" />
            <StatTile
              label="Current pricing"
              value={
                grant
                  ? 'Granted — no charge'
                  : paid
                    ? `${shortMoney(paid.unit_amount_minor, paid.currency)} / seat / ${paid.billing_interval === 'annual' ? 'yr' : 'mo'}`
                    : 'No subscription'
              }
              sub={
                grant
                  ? `${one(grant.plan)?.display_name ?? 'Plan'} · ${grant.grant_kind}`
                  : paid
                    ? `${one(paid.plan)?.display_name ?? 'Plan'} · ${paid.seats} seat${paid.seats === 1 ? '' : 's'}`
                    : 'Tenant has never checked out'
              }
            />
            <StatTile label="Users" value={compact(members ?? 0)} sub="Members of this tenant" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Workspaces" value={compact(workspaces ?? 0)} />
            <StatTile label="Projects" value={compact(projects ?? 0)} />
            <StatTile label="Tasks" value={compact(tasks ?? 0)} />
            <StatTile label="Subtasks" value={compact(subtasks ?? 0)} />
          </div>

          <SubscriptionControls
            orgId={organization.id}
            orgCurrency={organization.currency}
            readOnly={readOnly}
            paid={
              paid
                ? {
                    id: paid.id,
                    planName: one(paid.plan)?.display_name ?? 'Unknown plan',
                    status: paid.status,
                    provider: paid.provider,
                    currency: paid.currency,
                    interval: paid.billing_interval,
                    unitAmountMinor: paid.unit_amount_minor,
                    seats: paid.seats,
                    periodEnd: paid.current_period_end,
                    cancelAtPeriodEnd: paid.cancel_at_period_end,
                    needsReauthorization: paid.needs_reauthorization,
                    pendingPlanName: one(paid.pendingPlan)?.display_name ?? null,
                    pendingReason: paid.pending_reason,
                    pendingSynced: paid.pending_synced_at !== null,
                  }
                : null
            }
            grant={
              grant
                ? {
                    id: grant.id,
                    planName: one(grant.plan)?.display_name ?? 'Unknown plan',
                    kind: grant.grant_kind,
                    endsAt: grant.grant_ends_at,
                    reason: grant.grant_reason,
                  }
                : null
            }
            plans={(planRows ?? [])
              .filter((p) => !p.organization_id || p.organization_id === params.orgId)
              .map((p) => ({ id: p.id, name: p.display_name }))}
            prices={catalogue.map((row) => {
              const plan = one(row.plan)
              return {
                id: row.id,
                planId: plan?.id ?? '',
                planName: plan?.display_name ?? 'Plan',
                sort: plan?.sort_order ?? 0,
                currency: row.currency,
                interval: row.billing_interval as 'monthly' | 'annual',
                unitAmountMinor: row.unit_amount_minor,
                tenantSpecific: Boolean(plan?.organization_id),
              }
            })}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <h2 className="text-[13px] font-medium">Recent payments</h2>
              {!payments?.length ? (
                <p className="text-muted-foreground py-6 text-center text-xs">
                  No payment attempts recorded.
                </p>
              ) : (
                <ul className="divide-y divide-border-subtle pt-2">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                      <Badge
                        variant={
                          p.status === 'captured'
                            ? 'success'
                            : p.status === 'failed'
                              ? 'destructive'
                              : 'outline'
                        }
                        shape="meta"
                      >
                        {p.status}
                      </Badge>
                      <span className="flex-1 truncate text-xs">
                        {p.method ?? '—'}
                        {p.error_description ? (
                          <span className="text-destructive"> · {p.error_description}</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {shortMoney(p.amount_minor, p.currency)}
                      </span>
                      <span className="text-faint text-[10px] tabular-nums">
                        {formatDate(p.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <BarList
              title="Revenue by currency"
              data={[...revenue.entries()].map(([currency, value]) => ({
                label: currency,
                value,
                display: shortMoney(value, currency),
              }))}
              empty="No captured payments."
            />
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
