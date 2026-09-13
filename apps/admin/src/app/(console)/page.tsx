import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { compact, shortMoney } from '@/components/chart-format'
import { BarList, CompositionBar, StatTile, TrendChart } from '@/components/charts'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { COUNTRY_LABEL, STATUS_COLOR, monthKey, monthLabel, lastMonths } from './dashboard-shared'

export const metadata: Metadata = { title: 'Overview' }

/**
 * The platform at a glance — the console's landing page.
 *
 * Two rules shape every number here.
 *
 * MONEY IS NEVER SUMMED ACROSS CURRENCIES. There is no FX table in this system,
 * so adding a £ payment to a ₹ one would invent a figure. Instead one reporting
 * currency is chosen — the one carrying the most captured revenue — and every
 * money tile states it. Other currencies are listed separately rather than
 * folded in.
 *
 * PLAN COMES FROM `subscriptions`, NOT `organizations.plan_id`. 00037 is
 * explicit that the column grants nothing and is not the entitlement authority;
 * a tenant's real plan is their live subscription. Reading the column here
 * would make the console disagree with the product.
 */
export default async function OverviewPage() {
  await requireAdmin()
  const supabase = createAdminClient()

  const months = lastMonths(12)
  const since = months[0]?.start ?? new Date().toISOString()

  const [
    { data: orgs },
    { count: users },
    { count: projects },
    { count: tasks },
    { count: subtasks },
    { data: subs },
    { data: payments },
    { data: expenses },
  ] = await Promise.all([
    supabase.from('organizations').select('id, status, billing_country'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('projects').select('id', { count: 'exact', head: true }),
    supabase.from('tasks').select('id', { count: 'exact', head: true }),
    supabase.from('subtasks').select('id', { count: 'exact', head: true }),
    supabase
      .from('subscriptions')
      .select('organization_id, grant_kind, status, plan:plans!subscriptions_plan_id_fkey(display_name)')
      .in('status', ['active', 'past_due', 'authenticated', 'paused']),
    supabase
      .from('payments')
      .select('currency, amount_minor, amount_refunded_minor, captured_at, status')
      .eq('status', 'captured')
      .gte('captured_at', since),
    supabase
      .from('platform_expenses')
      .select('currency, amount_minor, incurred_on, category')
      .gte('incurred_on', since.slice(0, 10)),
  ])

  /* ---- Reporting currency: the one with the most captured revenue ---- */
  const revenueByCurrency = new Map<string, number>()
  for (const p of payments ?? []) {
    const net = p.amount_minor - (p.amount_refunded_minor ?? 0)
    revenueByCurrency.set(p.currency, (revenueByCurrency.get(p.currency) ?? 0) + net)
  }
  const expenseByCurrency = new Map<string, number>()
  for (const e of expenses ?? []) {
    expenseByCurrency.set(e.currency, (expenseByCurrency.get(e.currency) ?? 0) + e.amount_minor)
  }

  const currencies = [...new Set([...revenueByCurrency.keys(), ...expenseByCurrency.keys()])]
  const reporting =
    [...revenueByCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? currencies[0] ?? 'INR'

  const revenue = revenueByCurrency.get(reporting) ?? 0
  const expense = expenseByCurrency.get(reporting) ?? 0
  const margin = revenue - expense
  const others = currencies.filter((c) => c !== reporting)

  /* ---- Monthly trend, reporting currency only ---- */
  const revByMonth = new Map<string, number>()
  const expByMonth = new Map<string, number>()
  for (const p of payments ?? []) {
    if (p.currency !== reporting || !p.captured_at) continue
    const k = monthKey(p.captured_at)
    revByMonth.set(k, (revByMonth.get(k) ?? 0) + p.amount_minor - (p.amount_refunded_minor ?? 0))
  }
  for (const e of expenses ?? []) {
    if (e.currency !== reporting) continue
    const k = monthKey(e.incurred_on)
    expByMonth.set(k, (expByMonth.get(k) ?? 0) + e.amount_minor)
  }
  const trend = months.map((m) => ({
    label: monthLabel(m.key),
    a: revByMonth.get(m.key) ?? 0,
    b: expByMonth.get(m.key) ?? 0,
  }))

  /* ---- Tenants by status ---- */
  const statusOrder = ['active', 'trial', 'suspended', 'banned', 'churned'] as const
  const byStatus = new Map<string, number>()
  for (const o of orgs ?? []) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1)

  /* ---- Tenants by plan: the live subscription, not the org column ---- */
  const planOf = new Map<string, string>()
  for (const s of subs ?? []) {
    const plan = Array.isArray(s.plan) ? s.plan[0] : s.plan
    if (!plan) continue
    // A comp/early-access grant outranks a paid row (org_entitlements), and a
    // tenant may hold both; last writer wins is wrong, so prefer the grant.
    if (s.grant_kind !== 'paid' || !planOf.has(s.organization_id)) {
      planOf.set(s.organization_id, plan.display_name)
    }
  }
  const byPlan = new Map<string, number>()
  for (const o of orgs ?? []) {
    const name = planOf.get(o.id) ?? 'No subscription'
    byPlan.set(name, (byPlan.get(name) ?? 0) + 1)
  }

  /* ---- Tenants by region ---- */
  const byRegion = new Map<string, number>()
  for (const o of orgs ?? []) {
    const label = o.billing_country ? (COUNTRY_LABEL[o.billing_country] ?? o.billing_country) : 'Unspecified'
    byRegion.set(label, (byRegion.get(label) ?? 0) + 1)
  }

  const sortDesc = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))

  return (
    <>
      <AdminHeader
        title="Overview"
        description={`Money shown in ${reporting}, last 12 months.${
          others.length ? ` ${others.join(', ')} reported separately below.` : ''
        }`}
      />

      <AdminBody>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Revenue"
              value={shortMoney(revenue, reporting)}
              sub="Captured payments, less refunds"
              tone="good"
            />
            <StatTile
              label="Expense"
              value={shortMoney(expense, reporting)}
              sub="Recorded operating cost"
            />
            <StatTile
              label="Margin"
              value={shortMoney(margin, reporting)}
              sub={revenue > 0 ? `${Math.round((margin / revenue) * 100)}% of revenue` : 'No revenue yet'}
              tone={margin >= 0 ? 'good' : 'bad'}
            />
            <StatTile label="Organizations" value={compact(orgs?.length ?? 0)} sub="All tenants" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Users" value={compact(users ?? 0)} sub="Across every tenant" />
            <StatTile label="Projects" value={compact(projects ?? 0)} />
            <StatTile label="Tasks" value={compact(tasks ?? 0)} />
            <StatTile label="Subtasks" value={compact(subtasks ?? 0)} />
          </div>

          <TrendChart
            title="Revenue vs expense"
            points={trend}
            currency={reporting}
            aLabel="Revenue"
            bLabel="Expense"
          />

          <CompositionBar
            title="Tenants by status"
            segments={statusOrder
              .filter((s) => (byStatus.get(s) ?? 0) > 0)
              .map((s) => ({
                label: s,
                value: byStatus.get(s) ?? 0,
                color: STATUS_COLOR[s],
              }))}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <BarList title="Tenants by plan" data={sortDesc(byPlan)} />
            <BarList title="Tenants by region" data={sortDesc(byRegion)} />
          </div>

          {others.length > 0 ? (
            <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <h2 className="text-[13px] font-medium">Other currencies</h2>
              <p className="text-muted-foreground pt-1 text-xs">
                Shown separately because there is no exchange-rate source in this system — adding
                them to the figures above would invent a number.
              </p>
              <ul className="divide-y divide-border-subtle pt-2">
                {others.map((c) => (
                  <li key={c} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-mono">{c}</span>
                    <span className="text-muted-foreground tabular-nums">
                      revenue {shortMoney(revenueByCurrency.get(c) ?? 0, c)} · expense{' '}
                      {shortMoney(expenseByCurrency.get(c) ?? 0, c)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </AdminBody>
    </>
  )
}
