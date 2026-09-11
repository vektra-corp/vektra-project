import { describe, expect, it } from 'vitest'
import {
  canCreateTask,
  canCreateWorkspace,
  canDeleteTask,
  canManageProject,
  canUpdateTask,
  isProjectManager,
  type ProjectAccess,
} from '../rbac'

const access = (over: Partial<ProjectAccess> = {}): ProjectAccess => ({
  orgRole: 'member',
  projectRole: 'contributor',
  taskCreatePolicy: 'members',
  ...over,
})

describe('canCreateTask', () => {
  it('lets a project contributor create when the policy is "members"', () => {
    expect(canCreateTask(access())).toBe(true)
  })

  it('refuses an org member who is not on the project', () => {
    // The org matrix grants tasks.create, but the project is not theirs — this
    // is the hole that existed before project-level checks.
    expect(canCreateTask(access({ projectRole: null }))).toBe(false)
  })

  it('refuses a viewer even though their org role allows it', () => {
    expect(canCreateTask(access({ projectRole: 'viewer' }))).toBe(false)
  })

  it('refuses a plain member when the project reserves creation for managers', () => {
    expect(canCreateTask(access({ taskCreatePolicy: 'managers' }))).toBe(false)
  })

  it('allows an org manager under the managers-only policy', () => {
    expect(canCreateTask(access({ orgRole: 'manager', taskCreatePolicy: 'managers' }))).toBe(true)
  })

  it('allows the project owner under the managers-only policy', () => {
    expect(
      canCreateTask(access({ projectRole: 'owner', taskCreatePolicy: 'managers' })),
    ).toBe(true)
  })

  it('does not exempt an org owner from the project policy check', () => {
    // An owner passes because they outrank a manager, not because the policy is
    // skipped — the distinction matters if the policy ever gains a stricter tier.
    expect(canCreateTask(access({ orgRole: 'owner', taskCreatePolicy: 'managers' }))).toBe(true)
  })

  it('lets a manager create in a project they are not a member of', () => {
    expect(canCreateTask(access({ orgRole: 'manager', projectRole: null }))).toBe(true)
  })
})

describe('canUpdateTask', () => {
  it('is not restricted by the task-creation policy', () => {
    // The point of "managers only create" is that members still do the work.
    expect(canUpdateTask(access({ taskCreatePolicy: 'managers' }))).toBe(true)
  })

  it('refuses a viewer', () => {
    expect(canUpdateTask(access({ projectRole: 'viewer' }))).toBe(false)
  })

  it('refuses someone with no standing in the project', () => {
    expect(canUpdateTask(access({ projectRole: null }))).toBe(false)
  })
})

describe('canDeleteTask', () => {
  it('refuses a contributor, whose org role has no tasks.delete', () => {
    expect(canDeleteTask(access())).toBe(false)
  })

  it('allows a manager', () => {
    expect(canDeleteTask(access({ orgRole: 'manager' }))).toBe(true)
  })

  it('refuses a project owner whose ORG role cannot delete tasks', () => {
    // Project ownership does not manufacture an org permission.
    expect(canDeleteTask(access({ orgRole: 'member', projectRole: 'owner' }))).toBe(false)
  })
})

describe('isProjectManager / canManageProject', () => {
  it('counts an org manager', () => {
    expect(isProjectManager(access({ orgRole: 'manager' }))).toBe(true)
  })

  it('counts the project owner', () => {
    expect(isProjectManager(access({ projectRole: 'owner' }))).toBe(true)
  })

  it('excludes a plain contributor', () => {
    expect(canManageProject(access())).toBe(false)
  })
})

describe('canCreateWorkspace', () => {
  it('always allows an admin', () => {
    expect(canCreateWorkspace('admin', false)).toBe(true)
    expect(canCreateWorkspace('owner', false)).toBe(true)
  })

  it('refuses a manager by default', () => {
    expect(canCreateWorkspace('manager', false)).toBe(false)
  })

  it('allows a manager once the org delegates it', () => {
    expect(canCreateWorkspace('manager', true)).toBe(true)
  })

  it('never allows a plain member, delegated or not', () => {
    expect(canCreateWorkspace('member', true)).toBe(false)
  })
})
