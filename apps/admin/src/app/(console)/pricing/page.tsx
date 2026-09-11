import { GST_RATE_BP, grossFromNet } from '@pm/shared/billing'
import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
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

  const [{ data: prices }, { data: liveCounts }] = await Promise.all([
    supabase
      .from('plan_prices')
      .select(
        'id, currency, billing_interval, unit_amount_minor, is_active, plan:plans(id, tier, display_name, sort_order, organization_id)',
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
  for (const row of catalogue) {
    if (!row.plan) continue
    const entry = byPlan.get(row.plan.id) ?? {
      name: row.plan.display_name,
      tier: row.plan.tier,
      sort: row.plan.sort_order ?? 0,
      rows: [] as typeof catalogue,
    }
    entry.rows.push(row)
    byPlan.set(row.plan.id, entry)
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
          {plans.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm shadow-card">
              No catalogue plans found. Run the seed.
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
                  {plan.rows
                    .filter((row) => row.billing_interval === 'monthly')
                    .map((row) => (
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
