import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { currencyForCountry, featureEnabled, limitFor } from '@pm/shared/billing'
import { formatDate } from '@pm/shared/utils'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { razorpayConfigured, razorpayIsTestMode } from '@/lib/payments/config'
import { createClient } from '@/lib/supabase/server'
import { BillingHistory, type PaymentRow } from './billing-history'
import { BillingProfileForm } from './billing-profile-form'
import { PlanOptions, type PlanOption } from './plan-options'

export const metadata: Metadata = { title: 'Billing' }

/** Mirrors grace_period_days() in migration 00047. */
const GRACE_PERIOD_DAYS = 14

/**
 * What this organization is on, and what that includes.
 *
 * Everything here reads `auth.entitlements`, resolved by `org_entitlements()`
 * rather than from `organizations.plan_id` — which is no longer the authority
 * for anything, and which a tenant can no longer write (migration 00037).
 *
 * Checkout is offered only when the gateway is actually configured. A button
 * that cannot complete a payment is worse than no button, so an unconfigured
 * deployment renders the plan state and stops there.
 */
export default async function BillingPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)

  // Billing is owner and admin only (§8 permission matrix).
  if (!ORG_ADMIN_ROLES.includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const locale = await getLocale()
  const billingCurrency = currencyForCountry(auth.billingCountry)

  const [
    { data: usage },
    seatCount,
    { data: org },
    liveSubs,
    { data: paymentRows },
    { data: invoiceRows },
    { data: priceRows },
  ] = await Promise.all([
    supabase
      .from('usage_counters')
      .select('metric, current_value')
      .eq('organization_id', auth.orgId),
    supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId),
    supabase
      .from('organizations')
      .select('billing_country, billing_state, gstin')
      .eq('id', auth.orgId)
      .single(),
    // A live subscription freezes the billing country: set_billing_profile()
    // refuses to move it, so the form must say so rather than fail on submit.
    supabase
      .from('subscriptions')
      .select('id, status, grant_kind, provider, trial_ends_at, current_period_end')
      .eq('organization_id', auth.orgId)
      .in('status', ['pending', 'authenticated', 'active', 'past_due', 'paused']),
    // Both readable only by org admins, per the 00037 policies.
    supabase
      .from('payments')
      .select(
        'id, status, currency, amount_minor, method, created_at, captured_at, error_description',
      )
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('billing_invoices')
      .select('id, invoice_number, payment_id, pdf_storage_path')
      .eq('organization_id', auth.orgId)
      .eq('status', 'issued'),
    // RLS shows the public catalogue plus any plan custom-built for this tenant.
    supabase
      .from('plan_prices')
      .select('plan_id, unit_amount_minor, currency, plan:plans(id, tier, display_name, sort_order)')
      .eq('currency', billingCurrency)
      .eq('billing_interval', 'monthly')
      .eq('is_active', true),
    ])

  const { entitlements } = auth
  const seats = seatCount.count ?? 0

  const plans: PlanOption[] = (priceRows ?? [])
    .flatMap((row) => (row.plan ? [{ row, plan: row.plan }] : []))
    .sort((a, b) => (a.plan.sort_order ?? 0) - (b.plan.sort_order ?? 0))
    .map(({ row, plan }) => ({
      planId: plan.id,
      tier: plan.tier,
      displayName: plan.display_name,
      unitAmountMinor: row.unit_amount_minor,
      currency: row.currency,
    }))

  const invoiceByPayment = new Map(
    (invoiceRows ?? [])
      .filter((row) => row.payment_id)
      .map((row) => [
        row.payment_id as string,
        { id: row.id, number: row.invoice_number, ready: Boolean(row.pdf_storage_path) },
      ]),
  )

  const payments: PaymentRow[] = (paymentRows ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    currency: row.currency,
    amountMinor: row.amount_minor,
    method: row.method,
    createdAt: row.created_at,
    capturedAt: row.captured_at,
    errorDescription: row.error_description,
    invoice: invoiceByPayment.get(row.id) ?? null,
  }))

  const liveRows = liveSubs.data ?? []
  const billingCountry = org?.billing_country ?? null

  // set_billing_profile() refuses to move the country while a GATEWAY-backed
  // subscription is live. A manual grant (trial, comp) does not freeze it —
  // there is no mandate to invalidate.
  const billingFrozen = liveRows.some(
    (row) => row.provider !== 'manual' && ['pending', 'active', 'past_due'].includes(row.status),
  )

  const trial = liveRows.find((row) => row.grant_kind === 'trial' && row.trial_ends_at)
  const overdue = liveRows.find((row) => row.status === 'past_due')

  // Checkout is offered only once we know where to bill from. Without a country
  // the currency defaults to USD and the gateway resolves to PayPal, so an
  // Indian customer would be quoted dollars and then be unable to pay.
  const checkoutAvailable = razorpayConfigured() && plans.length > 0 && billingCountry !== null

  return (
    <SettingsPanel>
      <div className="space-y-6">
        <div>
          <h1 className="text-head font-semibold">Billing</h1>
          <p className="text-muted-foreground text-ui">
            Your current plan and what it includes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardDescription>Current plan</CardDescription>
                <CardTitle className="flex items-center gap-2">
                  {entitlements.planDisplayName}
                  <Badge variant={auth.orgStatus === 'active' ? 'secondary' : 'outline'}>
                    {auth.orgStatus}
                  </Badge>
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-ui">
            <SourceNote source={entitlements.source} />
            <p className="text-muted-foreground">
              {seats} {seats === 1 ? 'seat' : 'seats'} in use
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Included in your plan</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Limit label="Projects" value={limitFor(entitlements, 'projects')} />
              <Limit
                label="Workflows per workspace"
                value={limitFor(entitlements, 'workflows_per_workspace')}
              />
              <Limit
                label="Workflow runs per month"
                value={limitFor(entitlements, 'workflow_runs_per_month')}
              />
              <Feature label="Gantt timeline" enabled={featureEnabled(entitlements, 'gantt')} />
              <Feature
                label="Commercial documents"
                enabled={featureEnabled(entitlements, 'commercial')}
              />
              <Feature
                label="Custom fields"
                enabled={featureEnabled(entitlements, 'custom_fields')}
              />
              <Feature
                label="Custom roles"
                enabled={featureEnabled(entitlements, 'custom_roles')}
              />
            </dl>
          </CardContent>
        </Card>

        <LifecycleNotice
          trialEndsAt={trial?.trial_ends_at ?? null}
          overdue={Boolean(overdue)}
          locale={locale}
          dateFormat={billingCountry === 'IN' ? 'DD/MM/YYYY' : 'YYYY-MM-DD'}
        />

        <BillingProfileForm
          orgSlug={params.orgSlug}
          billingCountry={billingCountry}
          billingState={org?.billing_state ?? null}
          gstin={org?.gstin ?? null}
          canEdit={auth.orgRole === 'owner'}
          frozen={billingFrozen}
        />

        {checkoutAvailable ? (
          <>
            {razorpayIsTestMode() ? (
              <p className="text-muted-foreground text-xs">
                Test mode — no real money moves. Use Razorpay&rsquo;s test cards.
              </p>
            ) : null}
            <PlanOptions
              orgSlug={params.orgSlug}
              plans={plans}
              currentTier={entitlements.planTier}
              seats={Math.max(seats, 1)}
              locale={locale}
              canManage={ORG_ADMIN_ROLES.includes(auth.orgRole)}
            />
          </>
        ) : null}

        <BillingHistory
          orgSlug={params.orgSlug}
          payments={payments}
          locale={locale}
          dateFormat={billingCountry === 'IN' ? 'DD/MM/YYYY' : 'YYYY-MM-DD'}
        />

        {usage && usage.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Usage this period</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2">
                {usage.map((row) => (
                  <div key={row.metric} className="flex justify-between text-ui">
                    <dt className="text-muted-foreground">{row.metric}</dt>
                    <dd className="tabular-nums">{row.current_value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </SettingsPanel>
  )
}

/** Why this org has the plan it has. A comped or trial plan should say so. */
function SourceNote({ source }: { source: string }) {
  if (source === 'early_access') {
    return <p className="text-muted-foreground">Early Access — granted, no charge.</p>
  }
  if (source === 'comp') {
    return <p className="text-muted-foreground">Complimentary access — no charge.</p>
  }
  if (source === 'trial') {
    return <p className="text-muted-foreground">Trial.</p>
  }
  if (source === 'starter_default') {
    return <p className="text-muted-foreground">Free plan.</p>
  }
  return null
}

function Limit({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between text-ui">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value === null ? 'Unlimited' : value.toLocaleString()}</dd>
    </div>
  )
}

function Feature({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex justify-between text-ui">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={enabled ? '' : 'text-muted-foreground'}>
        {enabled ? 'Included' : 'Not included'}
      </dd>
    </div>
  )
}

/**
 * Where this organization stands in the billing lifecycle.
 *
 * Two states are worth interrupting someone for: a trial that is going to end,
 * and a payment that has failed. Both have a deadline attached, and a deadline
 * nobody can see is functionally a surprise — which is the one thing a billing
 * page should never produce.
 */
function LifecycleNotice({
  trialEndsAt,
  overdue,
  locale,
  dateFormat,
}: {
  trialEndsAt: string | null
  overdue: boolean
  locale: string
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD-MM-YYYY'
}) {
  if (overdue) {
    return (
      <div className="border-border bg-surface rounded-lg border p-4 text-ui">
        <p className="font-medium">A payment did not go through.</p>
        <p className="text-muted-foreground">
          Your plan stays active while we retry, for up to {GRACE_PERIOD_DAYS} days. After that the
          organization falls back to the free plan — nothing is deleted.
        </p>
      </div>
    )
  }

  if (!trialEndsAt) return null

  const endsAt = new Date(trialEndsAt)
  const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000))

  return (
    <div className="border-border bg-surface rounded-lg border p-4 text-ui">
      <p className="font-medium">
        {daysLeft === 0
          ? 'Your trial ends today.'
          : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left in your trial.`}
      </p>
      <p className="text-muted-foreground">
        Ends {formatDate(trialEndsAt, { locale, dateFormat })}. Choose a plan to keep these
        features — otherwise the organization moves to the free plan.
      </p>
    </div>
  )
}
