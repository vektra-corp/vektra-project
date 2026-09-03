/**
 * Permission keys used by custom roles (Enterprise tier). These are the keys
 * stored in `roles.permissions` jsonb, e.g. { "projects.create": true }.
 *
 * The role→permission matrix for the four SYSTEM roles lives in @pm/auth/rbac,
 * which is the single evaluator both apps call. This file only enumerates the
 * addressable surface so the roles editor UI can render it.
 */

export const MODULES = [
  'projects',
  'tasks',
  'commercial',
  'users',
  'billing',
  'workflows',
] as const
export type Module = (typeof MODULES)[number]

export const ACTIONS = ['create', 'read', 'update', 'delete', 'approve'] as const
export type Action = (typeof ACTIONS)[number]

export type PermissionKey = `${Module}.${Action}`

/** Actions that are meaningful for each module — drives the roles editor grid. */
export const MODULE_ACTIONS: Record<Module, readonly Action[]> = {
  projects: ['create', 'read', 'update', 'delete'],
  tasks: ['create', 'read', 'update', 'delete'],
  commercial: ['create', 'read', 'update', 'delete', 'approve'],
  users: ['create', 'read', 'update', 'delete'],
  billing: ['read', 'update'],
  workflows: ['create', 'read', 'update', 'delete'],
}

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = MODULES.flatMap((module) =>
  MODULE_ACTIONS[module].map((action) => `${module}.${action}` as PermissionKey),
)

export function permissionKey(module: Module, action: Action): PermissionKey {
  return `${module}.${action}`
}

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as readonly string[]).includes(value)
}
