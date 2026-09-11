'use server'

import { createHash, randomBytes } from 'node:crypto'
import {
  computeTax,
  currencyForCountry,
  subscriptionNetMinor,
  type BillingInterval,
} from '@pm/shared/billing'
import type { ActionResult } from '@pm/shared/types'
import { billingProfileSchema, fieldErrors } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { razorpayIsTestMode } from '@/lib/payments/config'
import { createPlan, createSubscription } from '@/lib/payments/razorpay'
import { selectProvider, sellerProfile } from '@/lib/payments/select'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * Starting a subscription.
 *
 * The shape of this action is dictated by two things in the schema (00037):
 *
 *  1. `subscriptions` is INSERT-revoked from `authenticated`, so the write goes
 *     through the service role. Reads stay on the user's client so RLS is still
 *     the thing deciding which plan they may buy.
 *  2. `subscriptions_one_live_per_org` means a second checkout while one is in
 *     flight is a unique violation, not a race to win. We let the database
 *     refuse it and translate the error, rather than checking first and hoping.
 *
 * Nothing about price or quantity is accepted from the client. The plan is
 * looked up, the seats are counted by `billable_seats()`, and the tax is
 * computed here — a form that could name its own amount would be a way to buy
 * Enterprise for one rupee.
 */

/** How long the post-checkout page may poll with the handle it was given. */
const CHECKOUT_TTL_MS = 30 * 60 * 1000

export interface CheckoutSession {
  /** Razorpay's subscription id, handed to Checkout in the browser. */
  providerSubscriptionId: string
  /** Publishable key id for the Checkout script. */
  keyId: string
  /** Opaque handle the post-checkout page polls with. Shown once. */
  checkoutToken: string
  /** Tax-inclusive, in minor units — what the gateway will actually charge. */
  amountMinor: number
  currency: string
  seats: number
  testMode: boolean
}

export async function startCheckout(
  orgSlug: string,
  input: { planId: string; interval: BillingInterval },
): Promise<ActionResult<CheckoutSession>> {
  try {
    const auth = await requireAuth(orgSlug)

    // Billing is owner and admin only (§8), re-checked server-side even though
    // the page already hides the controls for everyone else.
    if (auth.orgRole !== 'owner' && auth.orgRole !== 'admin') {
      return { ok: false, code: 'FORBIDDEN', message: 'Only owners and admins can manage billing.' }
    }

    if (input.interval !== 'monthly' && input.interval !== 'annual') {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown billing interval.' }
    }

    const supabase = createClient()

    const { data: org } = await supabase
      .from('organizations')
      .select('id, name, billing_country, billing_state, gstin')
      .eq('id', auth.orgId)
      .single()

    if (!org) return { ok: false, code: 'NOT_FOUND', message: 'Organization not found.' }

    const provider = selectProvider(org.billing_country)
    if (provider !== 'razorpay') {
      // PayPal's client is not written yet. Saying so plainly beats starting a
      // checkout that cannot complete.
      return {
        ok: false,
        code: 'NOT_IMPLEMENTED',
        message: 'Card payments for your billing country are not available yet.',
      }
    }

    const currency = currencyForCountry(org.billing_country)

    // RLS decides what is buyable: the public catalogue plus this tenant's own
    // custom plans. A planId for someone else's custom plan simply is not here.
    const { data: price } = await supabase
      .from('plan_prices')
      .select('id, unit_amount_minor, currency, billing_interval, plan:plans(id, display_name, tier)')
      .eq('plan_id', input.planId)
      .eq('currency', currency)
      .eq('billing_interval', input.interval)
      .eq('is_active', true)
      .maybeSingle()

    if (!price?.plan) {
      return { ok: false, code: 'NOT_FOUND', message: 'That plan is not available for purchase.' }
    }

    // Seats are counted in the database, never sent by the client.
    const { data: seatsValue } = await supabase.rpc('billable_seats', { p_org: auth.orgId })
    const seats = typeof seatsValue === 'number' && seatsValue >= 1 ? seatsValue : 1

    const seller = sellerProfile()
    const netMinor = subscriptionNetMinor(price.unit_amount_minor, seats)
    const tax = computeTax({
      netMinor,
      buyerCountry: org.billing_country,
      buyerGstin: org.gstin,
      buyerState: org.billing_state,
      sellerState: seller.state,
      lutArn: seller.lutArn,
    })

    // The gateway charges one inclusive figure; the invoice decomposes it later.
    const amountMinor = tax.totalMinor

    const db = createAdminClient()

    const providerPlanRefId = await resolveProviderPlanRef(db, {
      planPriceId: price.id,
      amountMinor,
      currency,
      interval: input.interval,
      planLabel: `${price.plan.display_name} — ${seats} ${seats === 1 ? 'seat' : 'seats'}`,
      orgId: auth.orgId,
    })

    // Claim the one live slot BEFORE calling the gateway. Doing it the other way
    // round would create a mandate at Razorpay that we then fail to record.
    const { data: subscription, error: insertError } = await db
      .from('subscriptions')
      .insert({
        organization_id: auth.orgId,
        plan_id: price.plan.id,
        plan_price_id: price.id,
        provider_plan_ref_id: providerPlanRefId,
        grant_kind: 'paid',
        provider: 'razorpay',
        status: 'pending',
        currency,
        billing_interval: input.interval,
        unit_amount_minor: price.unit_amount_minor,
        seats,
      })
      .select('id')
      .single()

    if (insertError?.code === '23505') {
      return {
        ok: false,
        code: 'SUBSCRIPTION_EXISTS',
        message: 'This organization already has a subscription in progress. Refresh and try again.',
      }
    }
    if (insertError || !subscription) {
      throw new Error(insertError?.message ?? 'Could not create subscription')
    }

    // From here on, any failure must release the slot we just claimed —
    // otherwise a transient gateway error locks the tenant out of checkout
    // permanently, since the partial index would refuse every retry.
    try {
      const { data: ref } = await db
        .from('provider_plan_refs')
        .select('provider_plan_id')
        .eq('id', providerPlanRefId)
        .single()

      const gateway = await createSubscription({
        planId: ref!.provider_plan_id,
        seats,
        interval: input.interval,
        notes: {
          organization_id: auth.orgId,
          organization: org.name.slice(0, 100),
          subscription_id: subscription.id,
        },
      })

      const checkoutToken = randomBytes(32).toString('base64url')

      const { error: updateError } = await db
        .from('subscriptions')
        .update({
          provider_subscription_id: gateway.id,
          provider_customer_id: gateway.customer_id ?? null,
          checkout_token_hash: createHash('sha256').update(checkoutToken).digest('hex'),
          checkout_expires_at: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString(),
        })
        .eq('id', subscription.id)

      if (updateError) throw new Error(updateError.message)

      return {
        ok: true,
        data: {
          providerSubscriptionId: gateway.id,
          keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '',
          checkoutToken,
          amountMinor,
          currency,
          seats,
          testMode: razorpayIsTestMode(),
        },
      }
    } catch (error) {
      await db.from('subscriptions').delete().eq('id', subscription.id).eq('status', 'pending')
      throw error
    }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Find or create the gateway-side plan for this exact amount.
 *
 * Razorpay plan amounts are immutable, so a price change or a seat change means
 * a different plan object. The five-column UNIQUE on `provider_plan_refs` is the
 * idempotency key: two concurrent checkouts at the same amount collide there
 * rather than creating two plans at the gateway.
 */
async function resolveProviderPlanRef(
  db: ReturnType<typeof createAdminClient>,
  input: {
    planPriceId: string
    amountMinor: number
    currency: string
    interval: BillingInterval
    planLabel: string
    orgId: string
  },
): Promise<string> {
  const existing = await db
    .from('provider_plan_refs')
    .select('id')
    .eq('plan_price_id', input.planPriceId)
    .eq('provider', 'razorpay')
    .eq('amount_minor', input.amountMinor)
    .maybeSingle()

  if (existing.data) return existing.data.id

  const plan = await createPlan({
    name: input.planLabel,
    amountMinor: input.amountMinor,
    currency: input.currency,
    interval: input.interval,
    notes: { plan_price_id: input.planPriceId, organization_id: input.orgId },
  })

  const { data, error } = await db
    .from('provider_plan_refs')
    .insert({
      plan_price_id: input.planPriceId,
      provider: 'razorpay',
      provider_plan_id: plan.id,
      provider_product_id: plan.item?.id ?? null,
      amount_minor: input.amountMinor,
      currency: input.currency,
    })
    .select('id')
    .single()

  // Lost the race to a concurrent checkout. The other one's row is equally
  // valid — the plan we just created at the gateway is simply unused.
  if (error?.code === '23505') {
    const { data: raced } = await db
      .from('provider_plan_refs')
      .select('id')
      .eq('plan_price_id', input.planPriceId)
      .eq('provider', 'razorpay')
      .eq('amount_minor', input.amountMinor)
      .single()
    return raced!.id
  }
  if (error || !data) throw new Error(error?.message ?? 'Could not record gateway plan')

  return data.id
}


/**
 * Set where an organization is billed from.
 *
 * This is the input that decides the gateway, the currency and the tax regime,
 * which is why the write goes through `set_billing_profile()` rather than a
 * direct UPDATE: the columns are revoked from `authenticated` (00037), the
 * function is owner-only, and it refuses to move the country once a
 * subscription is live. An owner who could switch to 'US' mid-relationship
 * would be choosing a zero-rated export invoice for a domestic supply.
 *
 * Until this is set, `billing_country` is NULL — which resolves to USD and
 * PayPal, so an Indian customer sees dollars and cannot check out at all.
 */
export async function updateBillingProfile(
  orgSlug: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const auth = await requireAuth(orgSlug)

    // set_billing_profile() enforces this too; checking here turns a Postgres
    // privilege exception into a message the form can render.
    if (auth.orgRole !== 'owner') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Only the owner can change billing details.',
      }
    }

    const parsed = billingProfileSchema.safeParse({
      billing_country: formData.get('billing_country'),
      billing_state: formData.get('billing_state'),
      gstin: formData.get('gstin'),
    })

    if (!parsed.success) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Check the highlighted fields.',
        fieldErrors: fieldErrors(parsed.error),
      }
    }

    const supabase = createClient()
    const { error } = await supabase.rpc('set_billing_profile', {
      p_country: parsed.data.billing_country,
      // The generated RPC signature models SQL DEFAULT NULL as an optional
      // argument, so an explicit null is not assignable — omit instead.
      p_state: parsed.data.billing_state ?? undefined,
      p_gstin: parsed.data.gstin ?? undefined,
    })

    if (error) {
      // The function raises this by name when a subscription is already live.
      if (error.message.includes('cannot change while a subscription is live')) {
        return {
          ok: false,
          code: 'BILLING_FROZEN',
          message:
            'Billing country cannot change while a subscription is active. Cancel first, or contact support.',
        }
      }
      return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
    }

    revalidatePath(`/${orgSlug}/settings/billing`)
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
