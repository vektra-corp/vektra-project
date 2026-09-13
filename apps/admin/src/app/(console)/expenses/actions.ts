'use server'

import { revalidatePath } from 'next/cache'
import { recordAdminAction } from '@/lib/audit'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { EXPENSE_CATEGORIES } from './constants'

export interface ExpenseResult {
  ok: boolean
  message?: string
}

/** Same ceiling as pricing: enough for any real figure, low enough to catch a typo. */
const MAX_MINOR = 100_000_000_00

/**
 * Record an operating cost.
 *
 * Amounts are entered in major units because that is how an operator thinks
 * about a bill, and converted once here — the same rule the pricing editor
 * follows, so a figure like 1499.99 cannot arrive as 149998 through float
 * drift.
 *
 * These are platform-level costs with no tenant, so only the operator trail is
 * written; `notifyTenant` does not apply because there is no organization.
 */
export async function recordExpense(formData: FormData): Promise<ExpenseResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const category = String(formData.get('category') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  const currency = String(formData.get('currency') ?? '').trim().toUpperCase()
  const rawAmount = String(formData.get('amount_major') ?? '').trim()
  const incurredOn = String(formData.get('incurred_on') ?? '').trim()
  const notes = String(formData.get('notes') ?? '').trim()

  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, message: 'Choose a category.' }
  }
  if (!description) return { ok: false, message: 'Describe what this was for.' }
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, message: 'Currency must be a 3-letter code.' }
  if (!incurredOn) return { ok: false, message: 'Pick the date it was incurred.' }

  const parsed = Number(rawAmount)
  if (!Number.isFinite(parsed) || parsed < 0) return { ok: false, message: 'That is not a valid amount.' }
  const amountMinor = Math.round(parsed * 100)
  if (amountMinor > MAX_MINOR) return { ok: false, message: 'That amount looks like a typo.' }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('platform_expenses')
    .insert({
      category,
      description,
      currency,
      amount_minor: amountMinor,
      incurred_on: incurredOn,
      notes: notes || null,
      recorded_by_admin_id: admin.adminUserId,
      recorded_by_email: admin.email,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: error.message }

  await recordAdminAction(admin, {
    action: 'expense.recorded',
    resourceType: 'platform_expense',
    resourceId: data.id,
    changes: { category, currency, amount_minor: amountMinor, incurred_on: incurredOn },
  })

  revalidatePath('/expenses')
  revalidatePath('/')
  return { ok: true }
}

/** Remove a mistaken entry. Expenses are corrigible — unlike an audit row. */
export async function deleteExpense(id: string): Promise<ExpenseResult> {
  const admin = await requireAdmin()
  if (!canWrite(admin.role)) return { ok: false, message: 'Your role is read-only.' }

  const supabase = createAdminClient()

  // Read first so the audit trail records WHAT was removed, not just that
  // something was — the row itself is about to stop existing.
  const { data: before } = await supabase
    .from('platform_expenses')
    .select('category, description, amount_minor, currency, incurred_on')
    .eq('id', id)
    .maybeSingle()

  if (!before) return { ok: false, message: 'That entry no longer exists.' }

  const { error } = await supabase.from('platform_expenses').delete().eq('id', id)
  if (error) return { ok: false, message: error.message }

  await recordAdminAction(admin, {
    action: 'expense.deleted',
    resourceType: 'platform_expense',
    resourceId: id,
    changes: { removed: before as unknown as Record<string, unknown> },
  })

  revalidatePath('/expenses')
  revalidatePath('/')
  return { ok: true }
}
