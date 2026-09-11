import 'server-only'

import type { createAdminClient } from '@/lib/supabase/admin'

/**
 * TEMPORARY: calls into migration 00047 that the generated types do not know yet.
 *
 * `packages/db/src/types.ts` is produced by `supabase gen types` from the
 * DEPLOYED schema, so anything added by a migration that has not been pushed is
 * absent from it. That is a good property — it means the types describe reality
 * rather than intent — but it leaves a window where new SQL cannot be called
 * type-safely.
 *
 * This module is that window, kept to one file and one shape so it is obvious
 * what to delete. After `supabase db push` and a types regeneration, replace
 * these calls with `db.rpc('expire_trials_and_lapse_overdue')` directly and
 * delete this file.
 *
 * The assertion goes through `unknown` rather than `any` (§16) and the return
 * shape is declared explicitly, so callers are still checked — only the
 * function NAME is unverified, and it is verified by the migration itself.
 */

export interface TrialSweepResult {
  trials_expired: number
  subscriptions_lapsed: number
}

type RpcCaller = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>

function rpcOf(db: ReturnType<typeof createAdminClient>): RpcCaller {
  return db.rpc as unknown as RpcCaller
}

/** `expire_trials_and_lapse_overdue()` — 00047. */
export async function callExpireTrialsAndLapseOverdue(
  db: ReturnType<typeof createAdminClient>,
): Promise<TrialSweepResult> {
  const { data, error } = await rpcOf(db)('expire_trials_and_lapse_overdue')
  if (error) throw new Error(error.message)

  // The function returns a single row; PostgREST hands set-returning functions
  // back as an array.
  const row = (Array.isArray(data) ? data[0] : data) as Partial<TrialSweepResult> | null

  return {
    trials_expired: row?.trials_expired ?? 0,
    subscriptions_lapsed: row?.subscriptions_lapsed ?? 0,
  }
}

/** `schedule_price_change(price, reason)` — 00047. Returns rows queued. */
export async function callSchedulePriceChange(
  db: ReturnType<typeof createAdminClient>,
  input: { priceId: string; reason?: string },
): Promise<number> {
  const { data, error } = await rpcOf(db)('schedule_price_change', {
    p_price_id: input.priceId,
    p_reason: input.reason ?? null,
  })
  if (error) throw new Error(error.message)
  return typeof data === 'number' ? data : 0
}

/**
 * `apply_pending_change(subscription)` — 00047.
 *
 * Called from the webhook when a charge lands: that is the moment a scheduled
 * price change has actually taken effect, so the snapshot may be rewritten.
 */
export async function callApplyPendingChange(
  db: ReturnType<typeof createAdminClient>,
  subscriptionId: string,
): Promise<boolean> {
  const { data, error } = await rpcOf(db)('apply_pending_change', {
    p_subscription_id: subscriptionId,
  })
  if (error) throw new Error(error.message)
  return data === true
}
