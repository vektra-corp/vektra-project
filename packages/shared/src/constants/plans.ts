/** Plan limits and feature gates. Mirrored into the `plans` table by seed/migration. */
export const PLAN_LIMITS = {
  starter: {
    projects: 10,
    storage_bytes: 1_073_741_824, // 1 GB
    max_file_size_bytes: 10_485_760, // 10 MB
    portal_users: 0,
    workflows_per_workspace: 3,
    workflow_runs_per_month: 500,
    documents_per_project: 5,
    custom_fields: false,
    custom_tables: false,
    gantt: false,
    subtask_kanban: false,
    commercial: false,
    custom_roles: false,
    api_access: false,
  },
  growth: {
    projects: null, // Unlimited
    storage_bytes: 10_737_418_240, // 10 GB
    max_file_size_bytes: 52_428_800, // 50 MB
    portal_users: 5,
    workflows_per_workspace: 20,
    workflow_runs_per_month: 5_000,
    documents_per_project: null,
    custom_fields: true,
    custom_tables: false,
    gantt: true,
    subtask_kanban: true,
    commercial: true,
    custom_roles: false,
    api_access: false,
  },
  enterprise: {
    projects: null,
    storage_bytes: null, // Custom
    max_file_size_bytes: 104_857_600, // 100 MB
    portal_users: null,
    workflows_per_workspace: null,
    workflow_runs_per_month: 50_000,
    documents_per_project: null,
    custom_fields: true,
    custom_tables: true,
    gantt: true,
    subtask_kanban: true,
    commercial: true,
    custom_roles: true,
    api_access: true,
  },
} as const

/**
 * The plan FAMILY. Since 00037 a plan's `name` is a free-form key (so an
 * operator can create `acme-growth-2026` for one tenant), which means the name
 * can no longer answer "which family is this". `tier` can, and it is what
 * "downgrade to Starter" and the missing-limit fallback both read.
 */
export const PLAN_TIERS = ['starter', 'growth', 'enterprise'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export type PlanLimits = (typeof PLAN_LIMITS)[PlanTier]

export const PLAN_DISPLAY_NAMES: Record<PlanTier, string> = {
  starter: 'Starter',
  growth: 'Growth',
  enterprise: 'Enterprise',
}

/** Numeric metrics tracked in `usage_counters`. */
export const METERED_METRICS = [
  'projects',
  'storage_bytes',
  'workflow_runs',
  'portal_users',
  'ai_tokens',
] as const

export type MeteredMetric = (typeof METERED_METRICS)[number]

/** Numeric keys inside a plan's `limits` jsonb. */
export const PLAN_LIMIT_KEYS = [
  'projects',
  'storage_bytes',
  'max_file_size_bytes',
  'portal_users',
  'workflows_per_workspace',
  'workflow_runs_per_month',
  'documents_per_project',
] as const

export type PlanLimitKey = (typeof PLAN_LIMIT_KEYS)[number]

/** Boolean capability gates. Keys match PLAN_LIMITS boolean fields. */
export const PLAN_FEATURES = [
  'custom_fields',
  'custom_tables',
  'gantt',
  'subtask_kanban',
  'commercial',
  'custom_roles',
  'api_access',
] as const

export type PlanFeature = (typeof PLAN_FEATURES)[number]

/**
 * `planHasFeature` and `planLimitFor` used to live here, keyed on the plan's
 * name. They were removed in 00037: a name-keyed lookup cannot describe an
 * operator-created custom plan, so such a plan gated exactly like Starter no
 * matter what its `features` jsonb said.
 *
 * Use `featureEnabled()` and `limitFor()` from `@pm/shared/billing` instead.
 * They read the plan's own jsonb, resolved per request by `org_entitlements()`,
 * and fall back to the tables above only as a floor.
 */

export const TRIAL_DAYS = 14
