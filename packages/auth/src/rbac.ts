import type { Action, Module, OrgRole, PermissionKey } from '@pm/shared/constants'
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
