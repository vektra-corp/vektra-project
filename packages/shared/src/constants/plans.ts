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

export type PlanName = keyof typeof PLAN_LIMITS
export type PlanLimits = (typeof PLAN_LIMITS)[PlanName]

export const PLAN_NAMES = ['starter', 'growth', 'enterprise'] as const

export const PLAN_DISPLAY_NAMES: Record<PlanName, string> = {
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

/** Whether a plan includes a boolean feature. Fails closed on an unknown plan (§2). */
export function planHasFeature(plan: PlanName | null | undefined, feature: PlanFeature): boolean {
  if (!plan) return false
  const limits = PLAN_LIMITS[plan] as Record<string, unknown> | undefined
  return limits?.[feature] === true
}

/** Numeric ceiling for a metric on a plan. `null` means unlimited. */
export function planLimitFor(
  plan: PlanName,
  metric: 'projects' | 'storage_bytes' | 'max_file_size_bytes' | 'portal_users',
): number | null {
  return PLAN_LIMITS[plan][metric]
}

export const TRIAL_DAYS = 14
