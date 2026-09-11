import type { Action, Module, OrgRole, PermissionKey, ProjectRole } from '@pm/shared/constants'
import { appError } from '@pm/shared/errors'
import { ORG_ROLE_RANK } from './constants'
import type { AuthContext } from './types'

/**
 * The permission matrix (claude.md §8).
 *
 * This is the single evaluator for role-based checks across both apps. It is
 * defence-in-depth on top of RLS, never the only layer (§2) — a bug here must
 * not be able to leak another tenant's data, because RLS still filters by org.
 */
const PERMISSION_MATRIX: Record<OrgRole, Record<Module, readonly Action[]>> = {
  owner: {
    projects: ['create', 'read', 'update', 'delete'],
    tasks: ['create', 'read', 'update', 'delete'],
    commercial: ['create', 'read', 'update', 'delete', 'approve'],
    users: ['create', 'read', 'update', 'delete'],
    billing: ['read', 'update'],
    workflows: ['create', 'read', 'update', 'delete'],
  },
  admin: {
    projects: ['create', 'read', 'update', 'delete'],
    tasks: ['create', 'read', 'update', 'delete'],
    commercial: ['create', 'read', 'update', 'delete', 'approve'],
    users: ['create', 'read', 'update', 'delete'],
    billing: ['read'],
    workflows: ['create', 'read', 'update', 'delete'],
  },
  manager: {
    projects: ['create', 'read', 'update'],
    tasks: ['create', 'read', 'update', 'delete'],
    commercial: ['create', 'read', 'update'],
    users: ['read'],
    billing: [],
    workflows: ['create', 'read', 'update'],
  },
  member: {
    projects: ['read'],
    tasks: ['create', 'read', 'update'],
    commercial: ['read'],
    users: ['read'],
    billing: [],
    workflows: ['read'],
  },
}

/**
 * Whether a system role grants an action.
 *
 * RULE (§2): fail closed. An unrecognized role or module yields `false` rather
 * than throwing or defaulting to allow.
 */
export function hasPermission(
  role: OrgRole | null | undefined,
  module: Module,
  action: Action,
): boolean {
  if (!role) return false
  const modulePermissions = PERMISSION_MATRIX[role]?.[module]
  if (!modulePermissions) return false
  return modulePermissions.includes(action)
}

/**
 * Permission check that honours a custom role's overrides (Enterprise tier).
 * An explicit `false` in the custom role revokes a permission the system role
 * would otherwise grant — deny always wins.
 */
export function can(context: AuthContext, module: Module, action: Action): boolean {
  const key: PermissionKey = `${module}.${action}`
  const override = context.customPermissions?.[key]
  if (override !== undefined) return override
  return hasPermission(context.orgRole, module, action)
}

/** Throws a 403 when the permission is absent. Use in every mutating entry point. */
export function assertPermission(
  role: OrgRole | null | undefined,
  module: Module,
  action: Action,
): void {
  if (!hasPermission(role, module, action)) {
    throw appError('FORBIDDEN', `Forbidden: ${role ?? 'anonymous'} cannot ${action} ${module}`, {
      module,
      action,
    })
  }
}

/** Context-aware variant of assertPermission that applies custom-role overrides. */
export function assertCan(context: AuthContext, module: Module, action: Action): void {
  if (!can(context, module, action)) {
    throw appError('FORBIDDEN', `Forbidden: ${context.orgRole} cannot ${action} ${module}`, {
      module,
      action,
    })
  }
}

/** Every permission a role holds, for rendering the roles matrix UI. */
export function permissionsFor(role: OrgRole): PermissionKey[] {
  const matrix = PERMISSION_MATRIX[role]
  return Object.entries(matrix).flatMap(([module, actions]) =>
    actions.map((action) => `${module}.${action}` as PermissionKey),
  )
}

export function isAtLeast(role: OrgRole | null | undefined, minimum: OrgRole): boolean {
  if (!role) return false
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum]
}

/**
 * Whether `actor` may change `target`'s role to `nextRole`.
 *
 * Rules: you cannot act on someone at or above your own rank, you cannot grant a
 * role above your own, and ownership is never transferred through this path.
 */
export function canManageRole(actor: OrgRole, target: OrgRole, nextRole: OrgRole): boolean {
  if (!hasPermission(actor, 'users', 'update')) return false
  if (nextRole === 'owner' || target === 'owner') return false
  if (ORG_ROLE_RANK[target] >= ORG_ROLE_RANK[actor]) return false
  return ORG_ROLE_RANK[nextRole] < ORG_ROLE_RANK[actor]
}

/** Parse a `roles.permissions` jsonb blob into typed overrides, ignoring junk keys. */
export function parseCustomPermissions(
  raw: unknown,
): Partial<Record<PermissionKey, boolean>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: Partial<Record<PermissionKey, boolean>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'boolean') {
      result[key as PermissionKey] = value
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

// -----------------------------------------------------------------------------
// Project-level authorization (claude.md §2 — fail closed)
// -----------------------------------------------------------------------------

/**
 * What a person may do inside one specific project.
 *
 * The org matrix above answers "may this role touch tasks at all?". It cannot
 * answer "…in THIS project?", and until now nothing did: an org `member` with
 * `tasks.create` could create a task in any project whose id they could name,
 * because the only other gate was RLS, which asks whether they can SEE the
 * project — and a project with `visibility = 'organization'` is visible to the
 * whole tenant.
 *
 * So both must hold: the org role permits the action in principle, and the
 * person's standing in the project permits it here.
 */
export interface ProjectAccess {
  /** Project membership row, absent when they are not named on the project. */
  projectRole: ProjectRole | null
  orgRole: OrgRole
  /** The project's own `task_create` policy. */
  taskCreatePolicy: 'members' | 'managers'
}

/**
 * Whoever runs the project: an org admin or above, an org manager, or the
 * person named as the project's owner. This is the "project manager" the task
 * creation policy talks about.
 */
export function isProjectManager(access: ProjectAccess): boolean {
  return isAtLeast(access.orgRole, 'manager') || access.projectRole === 'owner'
}

/** A viewer may read; they may never write, whatever their org role suggests. */
export function isProjectViewer(access: ProjectAccess): boolean {
  return access.projectRole === 'viewer'
}

/**
 * May this person create a task here?
 *
 * Three gates, all of which must pass: the org matrix, the project's own
 * policy, and not being a viewer. An org owner is NOT exempt from the project
 * policy — if a project says "managers only", that is a statement about how the
 * project is run, and an owner is a manager by rank anyway, so exempting them
 * would only ever weaken the rule for people it was written about.
 */
export function canCreateTask(access: ProjectAccess): boolean {
  if (!hasPermission(access.orgRole, 'tasks', 'create')) return false
  if (isProjectViewer(access)) return false
  if (access.taskCreatePolicy === 'managers') return isProjectManager(access)
  // 'members': anyone on the project, or anyone who runs it.
  return access.projectRole !== null || isProjectManager(access)
}

/**
 * May this person edit a task here?
 *
 * Deliberately NOT governed by `taskCreatePolicy` — restricting who opens work
 * is a planning decision, and the whole point of it is that members still do
 * the work they are given.
 */
export function canUpdateTask(access: ProjectAccess): boolean {
  if (!hasPermission(access.orgRole, 'tasks', 'update')) return false
  if (isProjectViewer(access)) return false
  return access.projectRole !== null || isProjectManager(access)
}

/** Deleting a task stays a manager power, as the org matrix already says. */
export function canDeleteTask(access: ProjectAccess): boolean {
  if (!hasPermission(access.orgRole, 'tasks', 'delete')) return false
  return isProjectManager(access)
}

/** Changing a project's own settings: managers and the project owner. */
export function canManageProject(access: ProjectAccess): boolean {
  return isProjectManager(access)
}

/**
 * Whether managers may create workspaces in this organization.
 *
 * Admins always may. Managers may only when the org has opted in — the same
 * flag the RLS policy reads, so the button and the database never disagree.
 */
export function canCreateWorkspace(
  orgRole: OrgRole,
  managersCanCreateWorkspaces: boolean,
): boolean {
  if (isAtLeast(orgRole, 'admin')) return true
  return orgRole === 'manager' && managersCanCreateWorkspaces
}
