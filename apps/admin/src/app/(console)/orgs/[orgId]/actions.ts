'use server'

import { revalidatePath } from 'next/cache'
import { recordAdminAction } from '@/lib/audit'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Per-tenant subscription operations.
 *
 * Every one of these maps onto a mechanism 00037/00047 already defined rather
 * than inventing a parallel one:
 *
 *   immediate    → write plan/price/amount onto the live row now
 *   next cycle   → pending_plan_id/pending_price_id, which the web app's sync
 *                  job pushes to the gateway with a cycle-end schedule
 *   no payment   → a separate provider='manual' grant row, which coexists with
 *                  a paid subscription (two partial unique indexes, 00047) and
 *                  outranks it in org_entitlements()
 *
 * The console holds NO gateway credentials by design (00037), so it can never
 * move money. Writing the intent IS the mechanism here, not a shortcut past one
 * — which is why "immediate" changes entitlement immediately but says plainly
 * in the UI that the mandate still debits the old amount until it syncs.
 */

export interface OrgActionResult {
  ok: boolean
  message?: string
}

const LIVE = ['pending', 'authenticated', 'active', 'past_due', 'paused'] as const

async function gate() {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { admin: null, error: 'Your role is read-only.' as const }
  return { admin, error: null }
}

/** The tenant's live PAID subscription, if any. */
async function livePaid(supabase: ReturnType<typeof createAdminClient>, orgId: string) {
  const { data } = await supabase
    .from('subscriptions')
    .select('id, plan_id, plan_price_id, unit_amount_minor, currency, billing_interval, seats, status')
    .eq('organization_id', orgId)
    .neq('provider', 'manual')
    .in('status', LIVE as unknown as string[])
    .maybeSingle()
  return data
}

/**
 * Move a tenant onto another plan.
 *
 * `when = 'immediate'` changes entitlement now. `when = 'next_cycle'` queues it
 * and changes nothing about what is charged today — the distinction the
 * pending_* columns exist to express.
 */
export async function changePlan(formData: FormData): Promise<OrgActionResult> {
  const { admin, error } = await gate()
  if (!admin) return { ok: false, message: error }

  const orgId = String(formData.get('org_id') ?? '')
  const priceId = String(formData.get('price_id') ?? '')
  const when = String(formData.get('when') ?? 'next_cycle')
  const reason = String(formData.get('reason') ?? '').trim()

  if (!orgId || !priceId) return { ok: false, message: 'Choose a plan and interval.' }
  if (when !== 'immediate' && when !== 'next_cycle') return { ok: false, message: 'Unknown timing.' }

  const supabase = createAdminClient()

  const { data: price } = await supabase
    .from('plan_prices')
    .select('id, plan_id, currency, billing_interval, unit_amount_minor, is_active')
    .eq('id', priceId)
    .maybeSingle()

  if (!price) return { ok: false, message: 'That price no longer exists.' }
  if (!price.is_active) return { ok: false, message: 'That price has been withdrawn.' }

  const subscription = await livePaid(supabase, orgId)
  if (!subscription) {
    return {
      ok: false,
      message:
        'This tenant has no live paid subscription to move. Use “Provision without payment” to grant a plan instead.',
    }
  }

  if (when === 'next_cycle') {
    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        pending_plan_id: price.plan_id,
        pending_price_id: price.id,
        pending_reason: reason || `Operator plan change by ${admin.email}`,
        pending_set_by_admin_id: null,
        // Not synced yet — the web app's job pushes it and stamps this.
        pending_synced_at: null,
      })
      .eq('id', subscription.id)

    if (updateError) return { ok: false, message: updateError.message }
  } else {
    // A currency change mid-mandate is not representable: the gateway holds an
    // approval in the original currency. Refuse rather than write a row whose
    // currency disagrees with the mandate behind it.
    if (price.currency !== subscription.currency) {
      return {
        ok: false,
        message: `This subscription is billed in ${subscription.currency}; that price is in ${price.currency}. The tenant must re-checkout to change currency.`,
      }
    }

    const { error: updateError } = await supabase
      .from('subscriptions')
      .update({
        plan_id: price.plan_id,
        plan_price_id: price.id,
        unit_amount_minor: price.unit_amount_minor,
        billing_interval: price.billing_interval,
        // The gateway still debits the old figure until the sync job catches
        // up, so the change is also queued rather than only applied locally.
        pending_plan_id: price.plan_id,
        pending_price_id: price.id,
        pending_reason: reason || `Immediate operator plan change by ${admin.email}`,
        pending_synced_at: null,
      })
      .eq('id', subscription.id)

    if (updateError) return { ok: false, message: updateError.message }
  }

  await recordAdminAction(admin, {
    action: when === 'immediate' ? 'subscription.plan_changed' : 'subscription.plan_change_scheduled',
    resourceType: 'subscription',
    resourceId: subscription.id,
    organizationId: orgId,
    changes: {
      plan_price_id: { old: subscription.plan_price_id, new: price.id },
      billing_interval: { old: subscription.billing_interval, new: price.billing_interval },
      when,
      reason: reason || null,
    },
  })

  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

/**
 * Grant a plan with no charge.
 *
 * Becomes a provider='manual' row, which the schema requires to be a grant
 * (`subscriptions_manual_is_a_grant`), and comp/early_access must carry an end
 * date (`subscriptions_grant_has_end`) — a grant that never ends is a plan
 * change, not a grant. Only one live grant per tenant exists, so an existing
 * one is ended rather than left to collide with the unique index.
 */
export async function provisionGrant(formData: FormData): Promise<OrgActionResult> {
  const { admin, error } = await gate()
  if (!admin) return { ok: false, message: error }

  const orgId = String(formData.get('org_id') ?? '')
  const planId = String(formData.get('plan_id') ?? '')
  const kind = String(formData.get('grant_kind') ?? 'comp')
  const endsAt = String(formData.get('grant_ends_at') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()
  const interval = String(formData.get('billing_interval') ?? 'monthly')

  if (!orgId || !planId) return { ok: false, message: 'Choose a plan.' }
  if (kind !== 'comp' && kind !== 'early_access') return { ok: false, message: 'Unknown grant type.' }
  if (!endsAt) return { ok: false, message: 'A grant must have an end date.' }
  if (interval !== 'monthly' && interval !== 'annual') {
    return { ok: false, message: 'Unknown billing interval.' }
  }

  const ends = new Date(endsAt)
  if (Number.isNaN(ends.getTime())) return { ok: false, message: 'That end date is not valid.' }
  if (ends.getTime() <= Date.now()) return { ok: false, message: 'The end date must be in the future.' }

  const supabase = createAdminClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, currency')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return { ok: false, message: 'Organization not found.' }

  // A grant is free, so the amount is zero by definition — but the row still
  // carries a price reference and a currency so reporting does not have to
  // special-case it (the shape grant_trial() already uses).
  const { data: price } = await supabase
    .from('plan_prices')
    .select('id, currency, unit_amount_minor')
    .eq('plan_id', planId)
    .eq('billing_interval', interval)
    .eq('is_active', true)
    .order('currency')
    .limit(1)
    .maybeSingle()

  // End any existing live grant first: subscriptions_one_live_grant_per_org
  // permits exactly one, so this is a replace, not an addition.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, grant_kind, plan_id')
    .eq('organization_id', orgId)
    .eq('provider', 'manual')
    .in('status', LIVE as unknown as string[])
    .maybeSingle()

  if (existing) {
    const { error: endError } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), ended_at: new Date().toISOString() })
      .eq('id', existing.id)
    if (endError) return { ok: false, message: endError.message }
  }

  const { data: created, error: insertError } = await supabase
    .from('subscriptions')
    .insert({
      organization_id: orgId,
      plan_id: planId,
      plan_price_id: price?.id ?? null,
      grant_kind: kind,
      provider: 'manual',
      status: 'active',
      currency: price?.currency ?? org.currency ?? 'INR',
      billing_interval: interval,
      unit_amount_minor: 0,
      seats: 1,
      grant_ends_at: ends.toISOString(),
      grant_reason: reason || `${kind} granted by ${admin.email}`,
    })
    .select('id')
    .single()

  if (insertError) return { ok: false, message: insertError.message }

  await recordAdminAction(admin, {
    action: 'subscription.granted',
    resourceType: 'subscription',
    resourceId: created.id,
    organizationId: orgId,
    changes: {
      grant_kind: kind,
      plan_id: planId,
      billing_interval: interval,
      grant_ends_at: ends.toISOString(),
      replaced: existing?.id ?? null,
      reason: reason || null,
    },
  })

  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

/** End a grant before its date, returning the tenant to whatever they pay for. */
export async function endGrant(formData: FormData): Promise<OrgActionResult> {
  const { admin, error } = await gate()
  if (!admin) return { ok: false, message: error }

  const orgId = String(formData.get('org_id') ?? '')
  const subscriptionId = String(formData.get('subscription_id') ?? '')
  if (!orgId || !subscriptionId) return { ok: false, message: 'Missing subscription.' }

  const supabase = createAdminClient()
  const now = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ status: 'cancelled', cancelled_at: now, ended_at: now })
    .eq('id', subscriptionId)
    .eq('organization_id', orgId)
    .eq('provider', 'manual')

  if (updateError) return { ok: false, message: updateError.message }

  await recordAdminAction(admin, {
    action: 'subscription.grant_ended',
    resourceType: 'subscription',
    resourceId: subscriptionId,
    organizationId: orgId,
  })

  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

/** Cancel at period end, or undo that. Never an immediate cut-off mid-cycle. */
export async function setCancelAtPeriodEnd(formData: FormData): Promise<OrgActionResult> {
  const { admin, error } = await gate()
  if (!admin) return { ok: false, message: error }

  const orgId = String(formData.get('org_id') ?? '')
  const subscriptionId = String(formData.get('subscription_id') ?? '')
  const cancel = String(formData.get('cancel') ?? 'true') === 'true'
  if (!orgId || !subscriptionId) return { ok: false, message: 'Missing subscription.' }

  const supabase = createAdminClient()
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({ cancel_at_period_end: cancel })
    .eq('id', subscriptionId)
    .eq('organization_id', orgId)

  if (updateError) return { ok: false, message: updateError.message }

  await recordAdminAction(admin, {
    action: cancel ? 'subscription.cancel_scheduled' : 'subscription.cancel_revoked',
    resourceType: 'subscription',
    resourceId: subscriptionId,
    organizationId: orgId,
  })

  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}

/** Drop a queued next-cycle change before the sync job pushes it. */
export async function clearPendingChange(formData: FormData): Promise<OrgActionResult> {
  const { admin, error } = await gate()
  if (!admin) return { ok: false, message: error }

  const orgId = String(formData.get('org_id') ?? '')
  const subscriptionId = String(formData.get('subscription_id') ?? '')
  if (!orgId || !subscriptionId) return { ok: false, message: 'Missing subscription.' }

  const supabase = createAdminClient()
  const { error: updateError } = await supabase
    .from('subscriptions')
    .update({
      pending_plan_id: null,
      pending_price_id: null,
      pending_seats: null,
      pending_reason: null,
      pending_synced_at: null,
    })
    .eq('id', subscriptionId)
    .eq('organization_id', orgId)
    // Once the gateway has accepted it, dropping the row here would leave the
    // two disagreeing about what is charged next cycle.
    .is('pending_synced_at', null)

  if (updateError) return { ok: false, message: updateError.message }

  await recordAdminAction(admin, {
    action: 'subscription.pending_change_cleared',
    resourceType: 'subscription',
    resourceId: subscriptionId,
    organizationId: orgId,
  })

  revalidatePath(`/orgs/${orgId}`)
  return { ok: true }
}
