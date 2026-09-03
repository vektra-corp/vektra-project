import { ORG_ROLES } from '@pm/shared/constants'
import { describe, expect, it } from 'vitest'
import {
  assertPermission,
  can,
  canManageRole,
  hasPermission,
  isAtLeast,
  parseCustomPermissions,
} from '../rbac'
import type { AuthContext } from '../types'

/** Permission matrix tests (claude.md §14: "Permission matrix logic"). */

function context(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u1',
    email: 'u1@example.test',
    orgId: 'o1',
    orgRole: 'member',
    mfaVerified: false,
    ...overrides,
  }
}

describe('hasPermission', () => {
  it('grants owners everything in the matrix', () => {
    expect(hasPermission('owner', 'billing', 'update')).toBe(true)
    expect(hasPermission('owner', 'commercial', 'approve')).toBe(true)
  })

  it('lets admins read billing but not change it', () => {
    expect(hasPermission('admin', 'billing', 'read')).toBe(true)
    expect(hasPermission('admin', 'billing', 'update')).toBe(false)
  })

  it('keeps members out of billing entirely', () => {
    expect(hasPermission('member', 'billing', 'read')).toBe(false)
    expect(hasPermission('member', 'billing', 'update')).toBe(false)
  })

  it('lets members work on tasks but not delete them', () => {
    expect(hasPermission('member', 'tasks', 'create')).toBe(true)
    expect(hasPermission('member', 'tasks', 'update')).toBe(true)
    expect(hasPermission('member', 'tasks', 'delete')).toBe(false)
  })

  it('only owners and admins approve commercial documents', () => {
    expect(hasPermission('manager', 'commercial', 'approve')).toBe(false)
    expect(hasPermission('admin', 'commercial', 'approve')).toBe(true)
  })

  // §2: fail closed.
  it('denies when the role is missing or unknown', () => {
    expect(hasPermission(null, 'tasks', 'read')).toBe(false)
    expect(hasPermission(undefined, 'tasks', 'read')).toBe(false)
    expect(hasPermission('nonsense' as never, 'tasks', 'read')).toBe(false)
  })

  it('never grants a permission absent from the matrix', () => {
    for (const role of ORG_ROLES) {
      expect(hasPermission(role, 'billing' as never, 'delete' as never)).toBe(false)
    }
  })
})

describe('assertPermission', () => {
  it('is silent when allowed', () => {
    expect(() => assertPermission('owner', 'projects', 'delete')).not.toThrow()
  })

  it('throws FORBIDDEN when denied', () => {
    expect(() => assertPermission('member', 'projects', 'delete')).toThrow(/Forbidden/)
  })
})

describe('custom role overrides', () => {
  it('revokes a permission the system role would grant', () => {
    const ctx = context({ orgRole: 'admin', customPermissions: { 'projects.delete': false } })
    expect(hasPermission('admin', 'projects', 'delete')).toBe(true)
    expect(can(ctx, 'projects', 'delete')).toBe(false)
  })

  it('can grant a permission the system role lacks', () => {
    const ctx = context({ orgRole: 'member', customPermissions: { 'tasks.delete': true } })
    expect(can(ctx, 'tasks', 'delete')).toBe(true)
  })

  it('falls back to the matrix when there is no override', () => {
    const ctx = context({ orgRole: 'manager' })
    expect(can(ctx, 'tasks', 'delete')).toBe(true)
    expect(can(ctx, 'billing', 'read')).toBe(false)
  })
})

describe('parseCustomPermissions', () => {
  it('keeps boolean entries and drops everything else', () => {
    expect(
      parseCustomPermissions({ 'tasks.delete': true, 'tasks.read': 'yes', junk: 1 }),
    ).toEqual({ 'tasks.delete': true })
  })

  it('returns undefined for non-objects and empty results', () => {
    expect(parseCustomPermissions(null)).toBeUndefined()
    expect(parseCustomPermissions('nope')).toBeUndefined()
    expect(parseCustomPermissions([])).toBeUndefined()
    expect(parseCustomPermissions({})).toBeUndefined()
  })
})

describe('isAtLeast', () => {
  it('compares by rank', () => {
    expect(isAtLeast('owner', 'admin')).toBe(true)
    expect(isAtLeast('manager', 'admin')).toBe(false)
    expect(isAtLeast('member', 'member')).toBe(true)
    expect(isAtLeast(null, 'member')).toBe(false)
  })
})

describe('canManageRole', () => {
  it('lets an admin manage a member', () => {
    expect(canManageRole('admin', 'member', 'manager')).toBe(true)
  })

  it('refuses to act on a peer or a senior', () => {
    expect(canManageRole('admin', 'admin', 'member')).toBe(false)
    expect(canManageRole('manager', 'admin', 'member')).toBe(false)
  })

  it('never grants a role above the actor', () => {
    expect(canManageRole('admin', 'member', 'admin')).toBe(false)
  })

  it('never routes ownership through role edits', () => {
    expect(canManageRole('owner', 'admin', 'owner')).toBe(false)
    expect(canManageRole('owner', 'owner', 'admin')).toBe(false)
  })

  it('refuses when the actor cannot manage users at all', () => {
    expect(canManageRole('member', 'member', 'member')).toBe(false)
  })
})
