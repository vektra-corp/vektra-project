import { featureEnabled, type Entitlements, type PlanFeature } from '@pm/shared/billing'
import { appError } from '@pm/shared/errors'
import type { Db } from '../helpers'

/**
 * `can_create` and `increment_usage_self` are introduced by migration 00037.
 * `types.ts` is generated from the live database, so it does not name them until
 * that migration is applied and `pnpm db:types` is re-run. The cast is confined
 * to this shim rather than widened across the file, and it disappears on the
 * next type generation.
 */
type UntypedRpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{
  data: unknown
  error: { message: string } | null
}>

function rpc(db: Db): UntypedRpc {
  return (db as unknown as { rpc: UntypedRpc }).rpc
}

/**
 * Plan limit enforcement (claude.md §17).
 *
 * Two different questions, answered two different ways:
 *
 *   - "May this org create one more?" goes through `can_create()`, which
 *     RECOUNTS the source table. Until 00037 this read `usage_counters`, which
 *     any member could reset by calling `increment_usage` with a negative
 *     delta — so the cap was advisory at best.
 *
 *   - "How much has this org used?" reads the counter, because that is a
 *     display figure and a table scan per page view is not worth it.
 */

export interface LimitCheck {
  allowed: boolean
  current: number
  limit: number | null
}

/** Usage for display. Reads the counter, so it is cheap and approximate. */
export async function checkPlanLimit(db: Db, orgId: string, metric: string): Promise<LimitCheck> {
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

/**
 * The gate. Authoritative, and scoped to the caller's own organization by the
 * JWT rather than by an argument — so it cannot be aimed at another tenant.
 *
 * Fails closed: a database error, a missing tenant context or an unresolvable
 * plan all deny (§2).
 */
export async function assertPlanLimit(db: Db, metric: string): Promise<void> {
  const { data, error } = await rpc(db)('can_create', { p_metric: metric })

  if (error || data !== true) {
    throw appError('PLAN_LIMIT', `Plan limit reached for ${metric}`, { metric })
  }
}

/**
 * Increment a counter for the CALLER'S OWN organization.
 *
 * The org comes from the JWT inside `increment_usage_self`, so a crafted call
 * cannot name someone else's tenant.
 */
export async function incrementUsage(db: Db, metric: string, delta = 1): Promise<void> {
  await rpc(db)('increment_usage_self', { p_metric: metric, p_delta: delta })
}

/**
 * Increment a counter for a named organization. SERVICE ROLE ONLY — the
 * underlying function is revoked from `authenticated`, so this throws for any
 * user session. For webhooks and background jobs, which have no JWT.
 */
export async function incrementUsageFor(
  db: Db,
  orgId: string,
  metric: string,
  delta = 1,
): Promise<void> {
  await rpc(db)('increment_usage', { org: orgId, p_metric: metric, p_delta: delta })
}

/**
 * Boolean feature gate.
 *
 * Takes resolved entitlements rather than a plan name: a name-keyed lookup
 * could not describe an operator-created custom plan, so such a plan gated
 * exactly like Starter however its `features` jsonb was written.
 */
export function assertFeature(
  entitlements: Entitlements | null | undefined,
  feature: PlanFeature,
): void {
  if (!featureEnabled(entitlements, feature)) {
    throw appError(
      'FEATURE_NOT_AVAILABLE',
      `${feature} is not included in the ${entitlements?.planName ?? 'current'} plan`,
      { feature },
    )
  }
}
