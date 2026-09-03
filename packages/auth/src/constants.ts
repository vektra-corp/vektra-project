import type { OrgRole, ProjectRole, WorkspaceRole } from '@pm/shared/constants'

/**
 * Role hierarchy. Higher rank implies every capability of a lower rank, but the
 * permission matrix in rbac.ts is still the authority — rank is only used for
 * comparisons like "can this user edit that user's role?".
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  member: 1,
}

export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  admin: 3,
  member: 2,
  viewer: 1,
}

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  owner: 3,
  contributor: 2,
  viewer: 1,
}

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
}

export const ORG_ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: 'Full control including billing and ownership transfer. Exactly one per organization.',
  admin: 'Manages members, workspaces and settings. Can read billing but not change the plan.',
  manager: 'Runs projects and approves work. No member management or billing access.',
  member: 'Works on assigned tasks. Read-only on projects and commercial documents.',
}

/** Roles that may be assigned through the members UI. Ownership transfers separately. */
export const ASSIGNABLE_ORG_ROLES: readonly OrgRole[] = ['admin', 'manager', 'member']

/** Only these roles reach the admin-ish areas of the customer app. */
export const ORG_ADMIN_ROLES: readonly OrgRole[] = ['owner', 'admin']

export const ORG_MANAGER_ROLES: readonly OrgRole[] = ['owner', 'admin', 'manager']

/** Access-token lifetime and refresh policy (claude.md §13.5). */
export const SESSION_POLICY = {
  ACCESS_TOKEN_TTL_SECONDS: 60 * 60, // 1 hour
  REFRESH_TOKEN_TTL_SECONDS: 60 * 60 * 24 * 30, // 30 days, rotated on use
  DEFAULT_IDLE_TIMEOUT_MINUTES: 30,
  FAILED_LOGIN_LIMIT: 5,
  FAILED_LOGIN_LOCKOUT_MINUTES: 15,
} as const

/** Route prefixes that never require an authenticated session. */
export const PUBLIC_ROUTE_PREFIXES = [
  '/login',
  '/signup',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/auth/callback',
  '/api/webhooks',
  '/api/inngest',
  '/403',
  '/404',
] as const
