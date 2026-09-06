import { PLAN_LIMITS, type PlanFeature, type PlanLimitKey, type PlanTier } from '../constants/plans'
import { ENTITLEMENT_SOURCES, type EntitlementSource } from './types'

/**
 * What an organization is actually allowed to do.
 *
 * Resolved in the database by `org_entitlements()` and carried on every request
 * by `current_auth_context`. It replaces the old `planHasFeature(planName, ...)`,
 * which keyed a hardcoded TypeScript table on the plan's NAME and therefore
 * granted a custom plan nothing at all — an operator could create one and it
 * would gate exactly like Starter.
 *
 * `limits` and `features` are the plan's own jsonb. They are the authority;
 * PLAN_LIMITS survives only as the seed for the catalogue and as the
 * conservative floor when a custom plan omits a key.
 */
export interface Entitlements {
  planName: string
  planTier: PlanTier
  planDisplayName: string
  features: Record<string, unknown>
  limits: Record<string, unknown>
  source: EntitlementSource
  subscriptionStatus: string
}

const TIERS: readonly PlanTier[] = ['starter', 'growth', 'enterprise']

function asTier(value: unknown): PlanTier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value)
    ? (value as PlanTier)
    : 'starter'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asSource(value: unknown): EntitlementSource {
  return typeof value === 'string' && (ENTITLEMENT_SOURCES as readonly string[]).includes(value)
    ? (value as EntitlementSource)
    : 'starter_default'
}

/** What an organization gets when nothing else resolves. Never a free upgrade. */
export const STARTER_ENTITLEMENTS: Entitlements = {
  planName: 'starter',
  planTier: 'starter',
  planDisplayName: 'Starter',
  features: PLAN_LIMITS.starter as unknown as Record<string, unknown>,
  limits: PLAN_LIMITS.starter as unknown as Record<string, unknown>,
  source: 'starter_default',
  subscriptionStatus: 'none',
}

/**
 * Build entitlements from a `current_auth_context` row.
 *
 * Every field is narrowed rather than cast, and anything unrecognised falls back
 * to Starter — a malformed row must never widen access.
 */
export function resolveEntitlements(row: {
  plan_name?: unknown
  plan_tier?: unknown
  plan_display_name?: unknown
  plan_limits?: unknown
  plan_features?: unknown
  entitlement_source?: unknown
  subscription_status?: unknown
}): Entitlements {
  const planTier = asTier(row.plan_tier)
  return {
    planName: typeof row.plan_name === 'string' ? row.plan_name : planTier,
    planTier,
    planDisplayName: typeof row.plan_display_name === 'string' ? row.plan_display_name : 'Starter',
    features: asRecord(row.plan_features),
    limits: asRecord(row.plan_limits),
    source: asSource(row.entitlement_source),
    subscriptionStatus:
      typeof row.subscription_status === 'string' ? row.subscription_status : 'none',
  }
}

/**
 * Whether a boolean capability is granted.
 *
 * Fails closed: anything that is not literally `true` is not granted, so a
 * missing key, a null, or the string "true" all deny (§2).
 */
export function featureEnabled(
  entitlements: Entitlements | null | undefined,
  feature: PlanFeature,
): boolean {
  return entitlements?.features?.[feature] === true
}

/**
 * The numeric ceiling for a metric. `null` means unlimited.
 *
 * A key ABSENT from a custom plan's jsonb is the dangerous case: treating it as
 * unlimited would turn an operator's typo into a free upgrade. So a missing key
 * falls back to the plan's TIER default, and an unknown tier falls back to
 * Starter.
 */
export function limitFor(
  entitlements: Entitlements | null | undefined,
  metric: PlanLimitKey,
): number | null {
  if (!entitlements) return PLAN_LIMITS.starter[metric] ?? 0

  if (metric in entitlements.limits) {
    const value = entitlements.limits[metric]
    if (value === null) return null
    if (typeof value === 'number' && Number.isFinite(value)) return value
    // Present but not a number: the plan is malformed. Fall through to the
    // tier default rather than trusting it.
  }

  return PLAN_LIMITS[entitlements.planTier][metric] ?? 0
}

/** True when the org is on the free tier because a subscription lapsed or ended. */
export function isDowngraded(entitlements: Entitlements | null | undefined): boolean {
  return entitlements?.source === 'starter_default' && entitlements.subscriptionStatus !== 'none'
}
