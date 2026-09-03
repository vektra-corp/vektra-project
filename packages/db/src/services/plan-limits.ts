import { PLAN_LIMITS, planHasFeature, type PlanFeature, type PlanName } from '@pm/shared/constants'
import { appError } from '@pm/shared/errors'
import type { Db } from '../helpers'

/**
 * Plan limit enforcement (claude.md §17).
 *
 * Every check reads the counter from the database rather than counting rows on
 * the fly, so a tenant with 50,000 tasks does not pay a table scan to create
 * the 50,001st.
 */

export interface LimitCheck {
  allowed: boolean
  current: number
  limit: number | null
}

export async function checkPlanLimit(
  db: Db,
  orgId: string,
  metric: string,
): Promise<LimitCheck> {
  const { data } = await db
    .from('usage_counters')
    .select('current_value, limit_value')
    .eq('organization_id', orgId)
    .eq('metric', metric)
    .maybeSingle()

  if (!data) return { allowed: true, current: 0, limit: null }
  if (data.limit_value === null) {
    return { allowed: true, current: data.current_value, limit: null }
  }

  return {
    allowed: data.current_value < data.limit_value,
    current: data.current_value,
    limit: data.limit_value,
  }
}

export async function assertPlanLimit(db: Db, orgId: string, metric: string): Promise<void> {
  const result = await checkPlanLimit(db, orgId, metric)
  if (!result.allowed) {
    throw appError('PLAN_LIMIT', `Plan limit reached for ${metric}`, {
      metric,
      current: result.current,
      limit: result.limit ?? 0,
    })
  }
}

/** Increment a metered counter. Atomic, so two concurrent creates cannot both slip under. */
export async function incrementUsage(
  db: Db,
  orgId: string,
  metric: string,
  delta = 1,
): Promise<void> {
  await db.rpc('increment_usage', { org: orgId, p_metric: metric, p_delta: delta })
}

/** Boolean feature gate. Fails closed when the plan is unknown (§2). */
export function assertFeature(plan: PlanName | null | undefined, feature: PlanFeature): void {
  if (!planHasFeature(plan, feature)) {
    throw appError('FEATURE_NOT_AVAILABLE', `${feature} is not included in the ${plan} plan`, {
      feature,
    })
  }
}

export function limitsFor(plan: PlanName) {
  return PLAN_LIMITS[plan]
}
