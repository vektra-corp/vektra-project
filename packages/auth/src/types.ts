import type {
  Action,
  Module,
  OrgRole,
  PermissionKey,
  ProjectRole,
  WorkspaceRole,
} from '@pm/shared/constants'

export type { Action, Module, OrgRole, PermissionKey, ProjectRole, WorkspaceRole }

/**
 * Custom claims injected by `public.custom_access_token_hook` (claude.md §6.9).
 * Anything not listed here is NOT in the JWT and must be looked up server-side.
 */
export interface JWTClaims {
  sub: string
  email?: string
  role?: string
  aal?: 'aal1' | 'aal2'
  exp: number
  /** Default organization for this session. */
  org_id?: string
  org_role?: OrgRole
}

/** The authenticated principal, resolved once per request. */
export interface AuthContext {
  userId: string
  email: string | null
  orgId: string
  orgRole: OrgRole
  /**
   * Permission overrides from a custom role (Enterprise). When present these
   * are merged over the system-role matrix.
   */
  customPermissions?: Partial<Record<PermissionKey, boolean>>
  /** True when the session has completed a second factor. */
  mfaVerified: boolean
}

export type RequestPrincipal = { kind: 'member' } & AuthContext

export interface PermissionCheck {
  module: Module
  action: Action
}
