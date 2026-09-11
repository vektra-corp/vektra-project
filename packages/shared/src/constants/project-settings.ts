/**
 * Per-project governance (claude.md §6.2 — `projects.settings` jsonb).
 *
 * Stored as jsonb rather than columns because these are policy knobs that grow
 * with the product; a migration per toggle would be a migration per opinion.
 * The cost is that nothing enforces the shape, so every read goes through
 * `resolveProjectSettings`, which is the only place a default is stated.
 */

/** Who may create tasks in a project. */
export const TASK_CREATE_POLICIES = ['members', 'managers'] as const
export type TaskCreatePolicy = (typeof TASK_CREATE_POLICIES)[number]

export const TASK_CREATE_POLICY_LABELS: Record<TaskCreatePolicy, string> = {
  members: 'Any project member',
  managers: 'Project managers only',
}

export const TASK_CREATE_POLICY_DESCRIPTIONS: Record<TaskCreatePolicy, string> = {
  members: 'Anyone on the project can add tasks. Best for delivery teams who plan together.',
  managers:
    'Only org admins, managers and project owners can add tasks. Members still work on and update what they are given.',
}

export interface ProjectSettings {
  taskCreate: TaskCreatePolicy
  /** Master switch for auto-assignment on this project. */
  autoAssign: boolean
  /**
   * Whether managers are eligible for auto-assignment.
   *
   * On by default so a project staffed only by managers still assigns, but
   * members are always tried first — see `orderCandidates`.
   */
  autoAssignManagers: boolean
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  taskCreate: 'members',
  autoAssign: true,
  autoAssignManagers: true,
}

function isTaskCreatePolicy(value: unknown): value is TaskCreatePolicy {
  return typeof value === 'string' && (TASK_CREATE_POLICIES as readonly string[]).includes(value)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Coerce a stored `projects.settings` blob into a usable shape.
 *
 * Fails towards the default rather than towards permissive or restrictive: a
 * junk value means "nobody has expressed an opinion here", and the default is
 * what the product would have done before the setting existed.
 */
export function resolveProjectSettings(raw: unknown): ProjectSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_PROJECT_SETTINGS

  const settings = raw as Record<string, unknown>
  return {
    taskCreate: isTaskCreatePolicy(settings.task_create)
      ? settings.task_create
      : DEFAULT_PROJECT_SETTINGS.taskCreate,
    autoAssign: bool(settings.auto_assign, DEFAULT_PROJECT_SETTINGS.autoAssign),
    autoAssignManagers: bool(
      settings.auto_assign_managers,
      DEFAULT_PROJECT_SETTINGS.autoAssignManagers,
    ),
  }
}

/** The jsonb form, for writing back. Keys are snake_case like every other column. */
export function serializeProjectSettings(settings: ProjectSettings): Record<string, unknown> {
  return {
    task_create: settings.taskCreate,
    auto_assign: settings.autoAssign,
    auto_assign_managers: settings.autoAssignManagers,
  }
}

/**
 * Organization-level policy (`organizations.settings` jsonb).
 *
 * Workspace creation is an admin power by default (§7's RLS says so too). This
 * lets an org delegate it to managers without weakening the policy for everyone
 * — the RLS check reads the same flag, so the UI and the database agree.
 */
export interface OrgPolicySettings {
  managersCanCreateWorkspaces: boolean
}

export const DEFAULT_ORG_POLICY: OrgPolicySettings = {
  managersCanCreateWorkspaces: false,
}

export function resolveOrgPolicy(raw: unknown): OrgPolicySettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_ORG_POLICY
  const settings = raw as Record<string, unknown>
  return {
    managersCanCreateWorkspaces: bool(
      settings.managers_can_create_workspaces,
      DEFAULT_ORG_POLICY.managersCanCreateWorkspaces,
    ),
  }
}

/**
 * Statuses a project may not delete.
 *
 * A board column IS a status (business rule 3), so "add a status" means "add a
 * column". Every project still needs somewhere for work to start, somewhere for
 * it to be in flight, and somewhere for it to land — `set_task_done`, the Gantt
 * and the completion counters all assume a done column exists. Renaming these
 * is free; removing them is not.
 */
export const PROTECTED_TASK_STATUSES = ['todo', 'in_progress', 'done'] as const

export function isProtectedStatus(status: string): boolean {
  return (PROTECTED_TASK_STATUSES as readonly string[]).includes(status)
}

/**
 * Whether a column may be deleted.
 *
 * The invariant is "a protected status always has SOMEWHERE to put work", not
 * "every column carrying a protected status is sacred". A project that adds
 * "Blocked" alongside "In Progress" — both mapping to `in_progress` — must be
 * able to remove "Blocked" again; locking it because of the status it borrows
 * would make custom statuses a one-way door.
 *
 * So a column is locked only when it is the LAST one holding a protected
 * status. `columnsSharingStatus` counts the column itself.
 */
export function isLastProtectedColumn(status: string, columnsSharingStatus: number): boolean {
  return isProtectedStatus(status) && columnsSharingStatus <= 1
}
