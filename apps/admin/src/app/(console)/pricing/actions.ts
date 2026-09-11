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
  const rpc = supabase.rpc as unknown as RpcCaller
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
 * The amount is entered tax-exclusive, because that is what `plan_prices` stores
 * and what an operator is actually deciding. The GST-inclusive figure shown back
 * is derived, never stored — storing it would make the invoice's own taxable
 * line unreconstructable without re-deriving a rate.
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
  admin: { userId: string; email: string },
  priceId: string,
  changes: Record<string, unknown>,
) {
  const supabase = createAdminClient()
  await supabase.from('platform_audit_logs').insert({
    admin_user_id: admin.userId,
    // Denormalised on the table so the trail survives an operator being deleted.
    admin_email: admin.email,
    action: 'plan_price.updated',
    resource_type: 'plan_price',
    resource_id: priceId,
    changes: changes as never,
  })
}
