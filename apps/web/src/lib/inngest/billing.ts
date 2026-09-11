import 'server-only'

import { createPlan, fetchSubscription } from '@/lib/payments/razorpay'
import { createAdminClient } from '@/lib/supabase/admin'
import { callExpireTrialsAndLapseOverdue } from './billing-rpc'
import { inngest } from './client'

/**
 * Billing lifecycle jobs.
 *
 * These run as service_role and bypass RLS, so every query scopes itself
 * explicitly (§13.10). None of them take a tenant id from a caller — each reads
 * the rows it is about to act on.
 */

/**
 * Close out expired trials and subscriptions whose grace period has run out.
 *
 * The work is one SQL function (`expire_trials_and_lapse_overdue`, 00047) rather
 * than a loop here: the sweep touches every tenant, and a job that fails halfway
 * through an application loop would leave some organizations expired and others
 * not, with no way to tell which from the outside.
 *
 * Hourly rather than nightly. A trial that ends at 14:00 and keeps working until
 * midnight is a fourteen-and-a-half-day trial, and the same slack at the other
 * end of a grace period means billing someone who had already lost access.
 */
export const sweepTrialsAndGrace = inngest.createFunction(
  { id: 'billing-sweep-trials-grace', retries: 2 },
  { cron: '10 * * * *' },
  async ({ step }) => {
    const result = await step.run('expire-and-lapse', async () => {
      const db = createAdminClient()
      const row = await callExpireTrialsAndLapseOverdue(db)
      return {
        trialsExpired: row.trials_expired,
        subscriptionsLapsed: row.subscriptions_lapsed,
      }
    })

    return result
  },
)

/**
 * Push queued price changes to the gateway, to take effect at the next renewal.
 *
 * An admin editing a price never changes what an existing subscriber is charged
 * — `subscriptions.unit_amount_minor` is a snapshot, so that half is structural.
 * This job is the other half: it moves those subscribers onto the new amount
 * from their NEXT cycle onwards.
 *
 * Razorpay plan amounts are immutable, so "change the price" means creating a
 * new plan object and pointing the subscription at it with
 * `schedule_change_at: 'cycle_end'`. The gateway keeps debiting the old amount
 * until the current period ends, which is exactly the required behaviour.
 */
export const syncPendingPriceChanges = inngest.createFunction(
  { id: 'billing-sync-price-changes', retries: 3 },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const queued = await step.run('load-queued', async () => {
      const db = createAdminClient()
      const { data, error } = await db
        .from('subscriptions')
        .select(
          'id, organization_id, provider, provider_subscription_id, seats, billing_interval, currency, pending_plan_id, pending_price_id',
        )
        .not('pending_price_id', 'is', null)
        .is('pending_synced_at', null)
        .eq('provider', 'razorpay')
        .in('status', ['active', 'past_due', 'authenticated'])
        .limit(50)
      if (error) throw new Error(error.message)
      return data ?? []
    })

    let synced = 0
    let deferred = 0

    for (const subscription of queued) {
      if (!subscription.provider_subscription_id || !subscription.pending_price_id) continue

      const outcome = await step.run(`sync-${subscription.id}`, async () => {
        const db = createAdminClient()

        const { data: price } = await db
          .from('plan_prices')
          .select('id, plan_id, unit_amount_minor, currency, billing_interval')
          .eq('id', subscription.pending_price_id!)
          .single()

        if (!price) return { status: 'skipped' as const }

        // Tax is recomputed from the tenant's CURRENT billing profile rather
        // than reused from the old subscription: a customer who registered a
        // GSTIN since signing up is now an inter-state supply, and the gateway
        // amount has to reflect that.
        const { data: org } = await db
          .from('organizations')
          .select('billing_country, billing_state, gstin')
          .eq('id', subscription.organization_id)
          .single()

        const { computeTax, subscriptionNetMinor } = await import('@pm/shared/billing')
        const { sellerProfile } = await import('@/lib/payments/select')
        const seller = sellerProfile()

        const netMinor = subscriptionNetMinor(price.unit_amount_minor, subscription.seats)
        const tax = computeTax({
          netMinor,
          buyerCountry: org?.billing_country,
          buyerGstin: org?.gstin,
          buyerState: org?.billing_state,
          sellerState: seller.state,
          lutArn: seller.lutArn,
        })
        const amountMinor = tax.totalMinor

        // Reuse the cached gateway plan for this exact amount if we have one.
        // The five-column UNIQUE is the idempotency key, so a retried run does
        // not create a second plan at Razorpay.
        const { data: existingRef } = await db
          .from('provider_plan_refs')
          .select('id, provider_plan_id')
          .eq('plan_price_id', price.id)
          .eq('provider', 'razorpay')
          .eq('amount_minor', amountMinor)
          .maybeSingle()

        let refId = existingRef?.id
        let providerPlanId = existingRef?.provider_plan_id

        if (!providerPlanId) {
          const plan = await createPlan({
            name: `Plan ${price.plan_id.slice(0, 8)} — ${subscription.seats} seat(s)`,
            amountMinor,
            currency: price.currency,
            interval: price.billing_interval as 'monthly' | 'annual',
            notes: { plan_price_id: price.id, organization_id: subscription.organization_id },
          })
          const inserted = await db
            .from('provider_plan_refs')
            .insert({
              plan_price_id: price.id,
              provider: 'razorpay',
              provider_plan_id: plan.id,
              provider_product_id: plan.item?.id ?? null,
              amount_minor: amountMinor,
              currency: price.currency,
            })
            .select('id, provider_plan_id')
            .single()

          if (inserted.error?.code === '23505') {
            const { data: raced } = await db
              .from('provider_plan_refs')
              .select('id, provider_plan_id')
              .eq('plan_price_id', price.id)
              .eq('provider', 'razorpay')
              .eq('amount_minor', amountMinor)
              .single()
            refId = raced?.id
            providerPlanId = raced?.provider_plan_id
          } else if (inserted.error) {
            throw new Error(inserted.error.message)
          } else {
            refId = inserted.data.id
            providerPlanId = inserted.data.provider_plan_id
          }
        }

        // Schedule at the gateway for the end of the current cycle.
        const updated = await updateSubscriptionPlanAtCycleEnd({
          providerSubscriptionId: subscription.provider_subscription_id!,
          providerPlanId: providerPlanId!,
          seats: subscription.seats,
        })

        if (!updated.ok) {
          // A raised amount beyond what the payer approved (PayPal) or beyond a
          // registered e-mandate ceiling (India) is refused by the gateway. The
          // OLD price stays in force and the owner is asked to re-approve — a
          // failed revise must never cause a lapse (00037).
          await db
            .from('subscriptions')
            .update({
              needs_reauthorization: true,
              reauthorization_url: updated.reauthorizationUrl ?? null,
            })
            .eq('id', subscription.id)
          return { status: 'deferred' as const }
        }

        await db
          .from('subscriptions')
          .update({
            provider_plan_ref_id: refId ?? null,
            pending_synced_at: new Date().toISOString(),
            needs_reauthorization: false,
            reauthorization_url: null,
          })
          .eq('id', subscription.id)

        return { status: 'synced' as const }
      })

      if (outcome.status === 'synced') synced += 1
      if (outcome.status === 'deferred') deferred += 1
    }

    return { considered: queued.length, synced, deferred }
  },
)

/**
 * Point a live Razorpay subscription at a new plan, effective next cycle.
 *
 * Kept here rather than in the gateway client because the cycle-end semantics
 * are a billing policy decision, not a transport detail: `schedule_change_at`
 * is what makes a price change land on the next invoice instead of prorating
 * into the current one.
 */
async function updateSubscriptionPlanAtCycleEnd(input: {
  providerSubscriptionId: string
  providerPlanId: string
  seats: number
}): Promise<{ ok: boolean; reauthorizationUrl?: string }> {
  const { razorpayCredentials } = await import('@/lib/payments/config')
  const { keyId, keySecret } = razorpayCredentials()
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')

  const response = await fetch(
    `https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(input.providerSubscriptionId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: input.providerPlanId,
        quantity: input.seats,
        schedule_change_at: 'cycle_end',
      }),
      cache: 'no-store',
    },
  )

  if (response.ok) return { ok: true }

  // 400 from Razorpay here is usually "amount exceeds the authorised mandate".
  // Treated as a deferral rather than a failure so the job does not retry
  // forever against a decision only the customer can change.
  if (response.status === 400) {
    const subscription = await fetchSubscription(input.providerSubscriptionId).catch(() => null)
    return { ok: false, reauthorizationUrl: subscription?.short_url }
  }

  throw new Error(`Razorpay subscription update failed with ${response.status}`)
}

/**
 * End a trial once a paid subscription for the same tenant goes live.
 *
 * The two can coexist — 00047 scopes the single-live-subscription index to
 * gateway-backed rows so an upgrade is not blocked — and `org_entitlements()`
 * already ranks paid above trial, so this is tidying rather than correctness.
 * Without it a trial row would sit in 'active' forever and every operator
 * reading the table would have to know to ignore it.
 */
export const closeSupersededTrials = inngest.createFunction(
  { id: 'billing-close-superseded-trials', retries: 2 },
  { cron: '25 * * * *' },
  async ({ step }) => {
    return step.run('close', async () => {
      const db = createAdminClient()

      const { data: paid } = await db
        .from('subscriptions')
        .select('organization_id')
        .eq('grant_kind', 'paid')
        .in('status', ['active', 'authenticated'])
        .limit(500)

      const orgIds = [...new Set((paid ?? []).map((row) => row.organization_id))]
      if (orgIds.length === 0) return { closed: 0 }

      const { data: closed, error } = await db
        .from('subscriptions')
        .update({ status: 'expired', ended_at: new Date().toISOString() })
        .eq('grant_kind', 'trial')
        .eq('provider', 'manual')
        .in('status', ['active', 'pending', 'authenticated'])
        .in('organization_id', orgIds)
        .select('id')

      if (error) throw new Error(error.message)
      return { closed: closed?.length ?? 0 }
    })
  },
)
