import { GST_RATE_BP, grossFromNet } from '@pm/shared/billing'
import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { NewPlanForm, NewPriceForm } from './catalogue-forms'
import { PriceEditor } from './price-editor'

export const metadata: Metadata = { title: 'Pricing' }

/**
 * The plan catalogue.
 *
 * Editing a price here cannot change what an existing customer is charged.
 * `subscriptions.unit_amount_minor` is a snapshot taken when the subscription
 * was created (00037), so the catalogue and a live mandate are separate numbers
 * by construction — not by anyone remembering to be careful.
 *
 * What an edit DOES do is queue every live paid subscription on that price to
 * move at its next renewal. The console holds no gateway credentials, so it
 * writes the intent and the web app's sync job pushes it to Razorpay with a
 * cycle-end schedule.
 */
export default async function PricingPage() {
  const admin = await requireAdmin()
  const readOnly = !canWrite(admin.role)
  const supabase = createAdminClient()

  const [{ data: plansRows }, { data: prices }, { data: liveCounts }] = await Promise.all([
    // Plans are fetched in their own right, not inferred from the prices that
    // reference them. Deriving the list from plan_prices meant a plan with no
    // price yet did not render at all — so a newly created plan was invisible,
    // and the only place to add its first price was on the row that was missing.
    supabase
      .from('plans')
      .select('id, tier, display_name, sort_order, organization_id, is_active')
      .is('organization_id', null)
      .order('sort_order'),
    supabase
      .from('plan_prices')
      .select(
        'id, plan_id, currency, billing_interval, unit_amount_minor, is_active, plan:plans(id, tier, display_name, sort_order, organization_id)',
      )
      .order('currency'),
    // Subscriber counts per price, so an operator can see the blast radius of a
    // change before making it.
    supabase
      .from('subscriptions')
      .select('plan_price_id')
      .eq('grant_kind', 'paid')
      .in('status', ['active', 'past_due', 'authenticated']),
  ])

  const subscribersByPrice = new Map<string, number>()
  for (const row of liveCounts ?? []) {
    if (!row.plan_price_id) continue
    subscribersByPrice.set(row.plan_price_id, (subscribersByPrice.get(row.plan_price_id) ?? 0) + 1)
  }

  // Catalogue plans only. A plan built for one tenant is that tenant's business
  // and is edited from their organization page, not from the global price list.
  const catalogue = (prices ?? []).filter((row) => row.plan && !row.plan.organization_id)

  const byPlan = new Map<string, { name: string; tier: string; sort: number; rows: typeof catalogue }>()
  // Seed from the plan list so a priceless plan still gets a section.
  for (const plan of plansRows ?? []) {
    byPlan.set(plan.id, {
      name: plan.display_name,
      tier: plan.tier ?? '—',
      sort: plan.sort_order ?? 0,
      rows: [] as typeof catalogue,
    })
  }
  for (const row of catalogue) {
    if (!row.plan) continue
    const entry = byPlan.get(row.plan.id)
    if (entry) entry.rows.push(row)
  }

  const plans = [...byPlan.entries()].sort((a, b) => a[1].sort - b[1].sort)

  return (
    <>
      <AdminHeader
        title="Pricing"
        description="Per-seat, tax-exclusive. A change takes effect for existing subscribers at their next renewal, never immediately."
      />

      <AdminBody>
        <div className="max-w-3xl space-y-4">
          {readOnly ? null : <NewPlanForm />}

          {plans.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm shadow-card">
              No catalogue plans with a price yet. Create a plan, then add a price to it.
            </p>
          ) : (
            plans.map(([planId, plan]) => (
              <section
                key={planId}
                className="overflow-hidden rounded-lg border border-border bg-surface px-4 shadow-card"
              >
                <header className="flex items-baseline justify-between border-b border-border-subtle py-3">
                  <h2 className="font-semibold">{plan.name}</h2>
                  <span className="label-meta text-faint">{plan.tier}</span>
                </header>

                <div className="divide-y divide-border-subtle">
                  {/*
                    Both intervals. Annual prices were previously filtered out
                    here, so a plan could have one in the database that no
                    operator could see or edit.
                  */}
                  {(['monthly', 'annual'] as const).map((interval) => {
                    const rows = plan.rows.filter((row) => row.billing_interval === interval)
                    if (rows.length === 0) return null
                    return (
                      <div key={interval} className="py-1">
                        <p className="label-meta text-faint pt-2">{interval}</p>
                        {rows.map((row) => (
                          <PriceEditor
                            key={row.id}
                            priceId={row.id}
                            currency={row.currency}
                            unitAmountMinor={row.unit_amount_minor}
                            grossMinor={
                              row.currency === 'INR'
                                ? grossFromNet(row.unit_amount_minor, GST_RATE_BP)
                                : row.unit_amount_minor
                            }
                            isActive={row.is_active}
                            activeSubscriptions={subscribersByPrice.get(row.id) ?? 0}
                            readOnly={readOnly}
                          />
                        ))}
                      </div>
                    )
                  })}
                  {readOnly ? null : (
                    <div>
                      <NewPriceForm planId={planId} planName={plan.name} />
                    </div>
                  )}
                </div>
              </section>
            ))
          )}

          <p className="text-muted-foreground text-xs">
            Amounts are tax-exclusive. Indian customers are charged the GST-inclusive figure shown
            beside each price; customers outside India are charged the ex-tax amount, zero-rated as
            an export.
          </p>
        </div>
      </AdminBody>
    </>
  )
}
