'use server'

import { revalidatePath } from 'next/cache'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Plan pricing.
 *
 * The one rule that shapes this whole file: editing a price must not change what
 * an existing paying customer is charged. That is guaranteed structurally, not by
 * care here — `subscriptions.unit_amount_minor` is a snapshot taken when the
 * subscription was created (00037), so the catalogue and the mandate are
 * genuinely separate numbers.
 *
 * What this file adds is the other half. After an edit, every live paid
 * subscription on that price is marked pending, and the web app's sync job
 * pushes the new amount to the gateway with a cycle-end schedule. The customer
 * keeps paying the old amount until their next renewal.
 *
 * The console holds no gateway credentials (00037) and cannot call Razorpay, so
 * queueing a row IS the mechanism, not a shortcut around one.
 */

export interface PricingResult {
  ok: boolean
  message?: string
}

/** Widest sane bounds for a per-seat monthly price, in minor units. */
const MIN_MINOR = 0
const MAX_MINOR = 100_000_000 // ₹10,00,000 / $1,000,000 per seat

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>

/**
 * TEMPORARY, matching apps/web/src/lib/inngest/billing-rpc.ts.
 *
 * `schedule_price_change` arrives in migration 00047 and the generated types are
 * produced from the deployed schema, so the name is unverifiable until that
 * migration is pushed. Delete this once types are regenerated.
 */
async function schedulePriceChange(
  supabase: ReturnType<typeof createAdminClient>,
  priceId: string,
  reason: string,
): Promise<number> {
  // Bound, not detached: `supabase.rpc` pulled off the client loses `this` and
  // throws "Cannot read properties of undefined (reading 'rest')" before it
  // ever reaches the database. Every price change was silently failing to queue
  // its subscribers this way.
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcCaller
  const { data, error } = await rpc('schedule_price_change', {
    p_price_id: priceId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
  return typeof data === 'number' ? data : 0
}

/**
 * Change a plan's per-seat price.
 *
 * The amount is entered TAX-INCLUSIVE: it is the figure the customer is charged,
 * which is what an operator is actually deciding. The GST contained within it is
 * derived for display, never stored — the invoice recomputes it as the remainder
 * after backing out the taxable base, so the two can never disagree.
 */
export async function updatePlanPrice(formData: FormData): Promise<PricingResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const priceId = String(formData.get('price_id') ?? '')
  const rawAmount = String(formData.get('unit_amount_major') ?? '').trim()

  if (!priceId) return { ok: false, message: 'Missing price.' }
  if (!rawAmount) return { ok: false, message: 'Enter an amount.' }

  // Entered in major units (rupees, dollars) and converted here. Parsed as a
  // decimal string and rounded once, so a value like 499.99 cannot arrive as
  // 49998 through float drift.
  const parsed = Number(rawAmount)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, message: 'That is not a valid amount.' }
  }
  const unitAmountMinor = Math.round(parsed * 100)

  if (unitAmountMinor < MIN_MINOR || unitAmountMinor > MAX_MINOR) {
    return { ok: false, message: 'That amount is outside the allowed range.' }
  }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from('plan_prices')
    .select('id, unit_amount_minor, currency, billing_interval, plan:plans(id, display_name)')
    .eq('id', priceId)
    .single()

  if (!existing) return { ok: false, message: 'That price no longer exists.' }
  if (existing.unit_amount_minor === unitAmountMinor) {
    return { ok: true, message: 'Unchanged.' }
  }

  const { error } = await supabase
    .from('plan_prices')
    .update({ unit_amount_minor: unitAmountMinor })
    .eq('id', priceId)

  if (error) return { ok: false, message: error.message }

  // Queue existing subscribers for their next renewal. A failure here leaves the
  // catalogue updated and nobody migrated, which is the safe direction: new
  // customers get the new price, existing ones keep paying what they agreed to
  // until a re-run picks them up.
  let queued = 0
  try {
    queued = await schedulePriceChange(
      supabase,
      priceId,
      `price changed from ${existing.unit_amount_minor} to ${unitAmountMinor} by ${admin.email}`,
    )
  } catch (cause) {
    await audit(admin, priceId, {
      unit_amount_minor: { old: existing.unit_amount_minor, new: unitAmountMinor },
      schedule_error: cause instanceof Error ? cause.message : 'unknown',
    })
    revalidatePath('/pricing')
    return {
      ok: false,
      message:
        'Price saved, but existing subscribers could not be queued. Re-save to retry — nobody has been charged differently.',
    }
  }

  await audit(admin, priceId, {
    unit_amount_minor: { old: existing.unit_amount_minor, new: unitAmountMinor },
    subscriptions_queued: queued,
  })

  revalidatePath('/pricing')

  return {
    ok: true,
    message:
      queued === 0
        ? 'Price updated. No existing subscribers on this price.'
        : `Price updated. ${queued} existing ${queued === 1 ? 'subscription' : 'subscriptions'} will move to it at their next renewal.`,
  }
}

/** Turn a plan price active or inactive. An inactive price cannot be bought. */
export async function setPlanPriceActive(formData: FormData): Promise<PricingResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const priceId = String(formData.get('price_id') ?? '')
  const isActive = String(formData.get('is_active') ?? '') === 'true'
  if (!priceId) return { ok: false, message: 'Missing price.' }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('plan_prices')
    .update({ is_active: isActive })
    .eq('id', priceId)

  if (error) return { ok: false, message: error.message }

  await audit(admin, priceId, { is_active: { new: isActive } })
  revalidatePath('/pricing')

  return {
    ok: true,
    message: isActive
      ? 'Price is available for new subscriptions.'
      : 'Price withdrawn. Existing subscribers are unaffected.',
  }
}

/**
 * Audit every pricing change.
 *
 * `audit_logs.organization_id` is NOT NULL, so a catalogue-wide change has no
 * tenant to file under and is written to `platform_audit_logs` instead — which
 * is what that table exists for.
 */
async function audit(
  admin: { adminUserId: string; email: string },
  priceId: string,
  changes: Record<string, unknown>,
) {
  const supabase = createAdminClient()
  // admin_user_id references admin_users(id), NOT auth.users(id). It was being
  // passed the auth id, so every insert here failed the foreign key — and
  // because the result was never checked, every pricing change went unaudited
  // in silence. The error is surfaced now rather than dropped.
  const { error } = await supabase.from('platform_audit_logs').insert({
    admin_user_id: admin.adminUserId,
    // Denormalised on the table so the trail survives an operator being deleted.
    admin_email: admin.email,
    action: 'plan_price.updated',
    resource_type: 'plan_price',
    resource_id: priceId,
    changes: changes as never,
  })
  if (error) throw new Error(`audit write failed: ${error.message}`)
}

/* ==========================================================================
 * Catalogue creation
 *
 * Until now the console could edit a price but never create a plan or add an
 * interval to one, so a catalogue could only be built by running the seed —
 * and an annual price, though fully modelled in plan_prices, had no way in at
 * all.
 * ========================================================================== */

const TIERS = ['starter', 'growth', 'enterprise'] as const

/**
 * Create a plan.
 *
 * `organization_id` is optional and is what separates a catalogue plan from one
 * built for a single tenant. A tenant-specific plan is deliberately NOT shown
 * on the public pricing list — it is that customer's commercial arrangement,
 * and it surfaces only on their organization page.
 */
export async function createPlan(formData: FormData): Promise<PricingResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const displayName = String(formData.get('display_name') ?? '').trim()
  const tier = String(formData.get('tier') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  const organizationId = String(formData.get('organization_id') ?? '').trim()

  if (!displayName) return { ok: false, message: 'Give the plan a name.' }
  if (!(TIERS as readonly string[]).includes(tier)) {
    return { ok: false, message: 'Choose a tier — it decides which limits apply.' }
  }

  const supabase = createAdminClient()

  // `plans.name` is the UNIQUE machine key; the display name is what an
  // operator typed. Derived rather than asked for, so the two cannot disagree.
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)

  if (!slug) return { ok: false, message: 'That name has no usable characters.' }

  // Limits and features come from the tier so a new plan is never born with an
  // empty entitlement set — copied from the newest existing plan on that tier.
  const { data: template } = await supabase
    .from('plans')
    .select('limits, features')
    .eq('tier', tier)
    .is('organization_id', null)
    .order('sort_order')
    .limit(1)
    .maybeSingle()

  const { data: created, error } = await supabase
    .from('plans')
    .insert({
      name: organizationId ? `${slug}_${organizationId.slice(0, 8)}` : slug,
      display_name: displayName,
      description: description || null,
      tier,
      organization_id: organizationId || null,
      limits: (template?.limits ?? {}) as never,
      features: (template?.features ?? {}) as never,
      is_active: true,
      created_by_admin_id: admin.adminUserId,
    })
    .select('id')
    .single()

  if (error) {
    return {
      ok: false,
      message: error.message.includes('duplicate')
        ? 'A plan with that name already exists.'
        : error.message,
    }
  }

  await audit(admin, created.id, { created: { display_name: displayName, tier, organization_id: organizationId || null } })
  revalidatePath('/pricing')
  if (organizationId) revalidatePath(`/orgs/${organizationId}`)

  return { ok: true, message: 'Plan created. Add a price before anyone can subscribe to it.' }
}

/**
 * Add a price to a plan.
 *
 * One row per (plan, currency, interval) — the table's UNIQUE — so adding an
 * annual price beside a monthly one is an insert, not an edit. Entered
 * tax-inclusive, matching what the column stores.
 */
export async function createPlanPrice(formData: FormData): Promise<PricingResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const planId = String(formData.get('plan_id') ?? '')
  const currency = String(formData.get('currency') ?? '').trim().toUpperCase()
  const interval = String(formData.get('billing_interval') ?? '')
  const rawAmount = String(formData.get('unit_amount_major') ?? '').trim()

  if (!planId) return { ok: false, message: 'Missing plan.' }
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: 'Currency must be a 3-letter code.' }
  if (interval !== 'monthly' && interval !== 'annual') {
    return { ok: false, message: 'Interval must be monthly or annual.' }
  }

  const parsed = Number(rawAmount)
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, message: 'That is not a valid amount.' }
  const unitAmountMinor = Math.round(parsed * 100)
  if (unitAmountMinor < MIN_MINOR || unitAmountMinor > MAX_MINOR) {
    return { ok: false, message: 'That amount is outside the allowed range.' }
  }

  const supabase = createAdminClient()
  const { data: created, error } = await supabase
    .from('plan_prices')
    .insert({
      plan_id: planId,
      currency,
      billing_interval: interval,
      unit_amount_minor: unitAmountMinor,
      is_active: true,
    })
    .select('id')
    .single()

  if (error) {
    return {
      ok: false,
      message: error.message.includes('duplicate')
        ? `That plan already has a ${interval} ${currency} price. Edit it instead.`
        : error.message,
    }
  }

  await audit(admin, created.id, {
    created: { plan_id: planId, currency, billing_interval: interval, unit_amount_minor: unitAmountMinor },
  })
  revalidatePath('/pricing')

  return { ok: true, message: 'Price added.' }
}
