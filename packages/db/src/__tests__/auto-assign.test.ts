import { describe, expect, it } from 'vitest'
import {
  chooseAssignee,
  eligiblePool,
  ruleFor,
  ruleMatches,
  type AssignmentRule,
  type Candidate,
  type CandidateTask,
} from '../services/auto-assign'

const ALICE = 'aaaaaaaa-0000-0000-0000-000000000001'
const BOB = 'bbbbbbbb-0000-0000-0000-000000000002'
const CARA = 'cccccccc-0000-0000-0000-000000000003'

const rule = (over: Partial<AssignmentRule> = {}): AssignmentRule => ({
  id: 'r1',
  name: 'Rule',
  projectId: null,
  method: 'round_robin',
  assigneePool: [ALICE, BOB, CARA],
  conditions: {},
  config: {},
  ...over,
})

const task = (over: Partial<CandidateTask> = {}): CandidateTask => ({
  id: 't1',
  projectId: 'p1',
  priority: 'medium',
  labelNames: [],
  ...over,
})

// Defaults describe the ordinary case: a member who is on the project. Tests
// that care about project membership or rank override them explicitly.
const person = (userId: string, over: Partial<Candidate> = {}): Candidate => ({
  userId,
  openTasks: 0,
  skills: [],
  onLeave: false,
  isProjectMember: true,
  orgRole: 'member',
  ...over,
})

const everyone = [person(ALICE), person(BOB), person(CARA)]

describe('ruleMatches', () => {
  it('treats absent conditions as a catch-all', () => {
    expect(ruleMatches(rule(), task())).toBe(true)
  })

  it('filters by project when the rule names one', () => {
    expect(ruleMatches(rule({ projectId: 'p1' }), task({ projectId: 'p1' }))).toBe(true)
    expect(ruleMatches(rule({ projectId: 'p2' }), task({ projectId: 'p1' }))).toBe(false)
  })

  it('matches any of the listed labels, not all', () => {
    const r = rule({ conditions: { labels: ['bug', 'regression'] } })
    expect(ruleMatches(r, task({ labelNames: ['bug'] }))).toBe(true)
    expect(ruleMatches(r, task({ labelNames: ['Bug'] }))).toBe(true)
    expect(ruleMatches(r, task({ labelNames: ['chore'] }))).toBe(false)
  })

  it('filters by priority', () => {
    const r = rule({ conditions: { priority: ['high', 'critical'] } })
    expect(ruleMatches(r, task({ priority: 'critical' }))).toBe(true)
    expect(ruleMatches(r, task({ priority: 'low' }))).toBe(false)
  })

  it('ignores junk in the conditions blob rather than throwing', () => {
    const r = rule({ conditions: { labels: 'bug', priority: 42 } })
    expect(ruleMatches(r, task())).toBe(true)
  })
})

describe('round robin', () => {
  it('advances one position each call and reports the new cursor', () => {
    const first = chooseAssignee(rule({ config: { last_index: -1 } }), task(), everyone)
    expect(first?.userId).toBe(ALICE)
    expect(first?.nextConfig?.last_index).toBe(0)

    const second = chooseAssignee(rule({ config: { last_index: 0 } }), task(), everyone)
    expect(second?.userId).toBe(BOB)
    expect(second?.nextConfig?.last_index).toBe(1)
  })

  it('wraps around the end of the pool', () => {
    const result = chooseAssignee(rule({ config: { last_index: 2 } }), task(), everyone)
    expect(result?.userId).toBe(ALICE)
    expect(result?.nextConfig?.last_index).toBe(0)
  })

  it('skips someone on leave without losing its place in the rotation', () => {
    const candidates = [person(ALICE), person(BOB, { onLeave: true }), person(CARA)]
    const result = chooseAssignee(rule({ config: { last_index: 0 } }), task(), candidates)
    // Bob is away, so Cara takes the turn — and the cursor lands on Cara's
    // index, not Bob's, so the next call continues correctly.
    expect(result?.userId).toBe(CARA)
    expect(result?.nextConfig?.last_index).toBe(2)
  })

  it('assigns anyway when the entire pool is on leave', () => {
    const allAway = everyone.map((c) => ({ ...c, onLeave: true }))
    const result = chooseAssignee(rule({ config: { last_index: -1 } }), task(), allAway)
    // Better to assign someone away than to silently drop the task.
    expect(result?.userId).toBe(ALICE)
  })

  it('honours respect_leave: false', () => {
    const candidates = [person(ALICE, { onLeave: true }), person(BOB), person(CARA)]
    const result = chooseAssignee(
      rule({ config: { last_index: -1, respect_leave: false } }),
      task(),
      candidates,
    )
    expect(result?.userId).toBe(ALICE)
  })
})

describe('load balanced', () => {
  it('picks the person with the fewest open tasks', () => {
    const candidates = [
      person(ALICE, { openTasks: 5 }),
      person(BOB, { openTasks: 2 }),
      person(CARA, { openTasks: 9 }),
    ]
    const result = chooseAssignee(rule({ method: 'load_balanced' }), task(), candidates)
    expect(result?.userId).toBe(BOB)
  })

  it('breaks ties on pool order, deterministically', () => {
    const candidates = [person(CARA), person(BOB), person(ALICE)]
    const result = chooseAssignee(rule({ method: 'load_balanced' }), task(), candidates)
    // All at zero; the rule's own ordering decides, not the row order.
    expect(result?.userId).toBe(ALICE)
  })

  it('assigns nobody when everyone is at the cap', () => {
    const candidates = everyone.map((c) => ({ ...c, openTasks: 10 }))
    const result = chooseAssignee(
      rule({ method: 'load_balanced', config: { max_concurrent: 10 } }),
      task(),
      candidates,
    )
    expect(result).toBeNull()
  })
})

describe('skill based', () => {
  const skilled = [
    person(ALICE, { skills: ['react'], openTasks: 1 }),
    person(BOB, { skills: ['react', 'postgres'], openTasks: 4 }),
    person(CARA, { skills: ['design'] }),
  ]

  it('requires every listed skill', () => {
    const result = chooseAssignee(
      rule({ method: 'skill_based', config: { required_skills: ['react', 'postgres'] } }),
      task(),
      skilled,
    )
    expect(result?.userId).toBe(BOB)
  })

  it('spreads load among equally skilled people', () => {
    const result = chooseAssignee(
      rule({ method: 'skill_based', config: { required_skills: ['react'] } }),
      task(),
      skilled,
    )
    // Alice and Bob both have react; Alice has fewer open tasks.
    expect(result?.userId).toBe(ALICE)
  })

  it('falls back when nobody has the skill', () => {
    const result = chooseAssignee(
      rule({
        method: 'skill_based',
        config: { required_skills: ['cobol'], fallback: 'round_robin', last_index: -1 },
      }),
      task(),
      skilled,
    )
    expect(result?.userId).toBe(ALICE)
  })

  it('assigns nobody when there is no skill match and no fallback', () => {
    const result = chooseAssignee(
      rule({ method: 'skill_based', config: { required_skills: ['cobol'] } }),
      task(),
      skilled,
    )
    expect(result).toBeNull()
  })
})

describe('random', () => {
  it('stays inside the pool even at the boundary', () => {
    // Math.random() can return a value that floors to length.
    const result = chooseAssignee(rule({ method: 'random' }), task(), everyone, () => 0.999999999)
    expect(result?.userId).toBe(CARA)

    const first = chooseAssignee(rule({ method: 'random' }), task(), everyone, () => 0)
    expect(first?.userId).toBe(ALICE)
  })
})

describe('pool resolution', () => {
  it('assigns nobody when the pool resolves to no one', () => {
    expect(chooseAssignee(rule({ assigneePool: [] }), task(), everyone)).toBeNull()
    // Pool names people who are no longer org members.
    expect(chooseAssignee(rule({ assigneePool: ['ghost'] }), task(), everyone)).toBeNull()
  })
})

describe('ruleFor', () => {
  it('prefers a project rule over a workspace-wide one', () => {
    const rules = [
      rule({ id: 'wide', name: 'A wide rule' }),
      rule({ id: 'narrow', name: 'Z narrow rule', projectId: 'p1' }),
    ]
    expect(ruleFor(rules, task({ projectId: 'p1' }))?.id).toBe('narrow')
  })

  it('breaks ties on name so the outcome is not row-order dependent', () => {
    const rules = [rule({ id: 'b', name: 'Beta' }), rule({ id: 'a', name: 'Alpha' })]
    expect(ruleFor(rules, task())?.id).toBe('a')
  })

  it('returns null when nothing matches', () => {
    const rules = [rule({ conditions: { priority: ['critical'] } })]
    expect(ruleFor(rules, task({ priority: 'low' }))).toBeNull()
  })
})

describe('eligiblePool — project membership and rank', () => {
  it('excludes anyone who is not on the project', () => {
    const pool = [
      person(ALICE, { isProjectMember: false }),
      person(BOB, { isProjectMember: true }),
    ]
    expect(eligiblePool(pool).map((c) => c.userId)).toEqual([BOB])
  })

  it('returns nobody when no candidate is on the project', () => {
    const pool = [person(ALICE, { isProjectMember: false })]
    expect(eligiblePool(pool)).toEqual([])
  })

  it('prefers members over managers when both are on the project', () => {
    const pool = [
      person(ALICE, { orgRole: 'manager' }),
      person(BOB, { orgRole: 'member' }),
    ]
    expect(eligiblePool(pool).map((c) => c.userId)).toEqual([BOB])
  })

  it('falls back to managers when the project has no members on it', () => {
    const pool = [person(ALICE, { orgRole: 'manager' }), person(CARA, { orgRole: 'admin' })]
    expect(eligiblePool(pool).map((c) => c.userId)).toEqual([ALICE, CARA])
  })

  it('refuses managers when the project has turned that off', () => {
    const pool = [person(ALICE, { orgRole: 'manager' })]
    expect(eligiblePool(pool, { autoAssign: true, autoAssignManagers: false })).toEqual([])
  })

  it('still prefers members when manager fallback is off', () => {
    const pool = [
      person(ALICE, { orgRole: 'manager' }),
      person(BOB, { orgRole: 'member' }),
    ]
    const result = eligiblePool(pool, { autoAssign: true, autoAssignManagers: false })
    expect(result.map((c) => c.userId)).toEqual([BOB])
  })
})

describe('chooseAssignee — project policy', () => {
  it('assigns nobody when the project has auto-assignment off', () => {
    const decision = chooseAssignee(rule(), task(), everyone, Math.random, {
      autoAssign: false,
      autoAssignManagers: true,
    })
    expect(decision).toBeNull()
  })

  it('skips a pool member who is not on the project', () => {
    const candidates = [
      person(ALICE, { isProjectMember: false }),
      person(BOB),
      person(CARA),
    ]
    const decision = chooseAssignee(rule({ method: 'round_robin' }), task(), candidates)
    expect(decision?.userId).not.toBe(ALICE)
  })

  it('load balances only across members, not managers', () => {
    const candidates = [
      // The manager is idle and would win on load alone.
      person(ALICE, { orgRole: 'manager', openTasks: 0 }),
      person(BOB, { orgRole: 'member', openTasks: 5 }),
    ]
    const decision = chooseAssignee(
      rule({ method: 'load_balanced', assigneePool: [ALICE, BOB] }),
      task(),
      candidates,
    )
    expect(decision?.userId).toBe(BOB)
  })
})
