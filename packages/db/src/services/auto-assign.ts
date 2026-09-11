/**
 * Auto-assignment rule evaluation (claude.md §19.6).
 *
 * Deliberately pure: picking an assignee is the part with real logic and real
 * edge cases, so it is separated from the job that loads rows and writes the
 * result. Everything here is decidable from its arguments.
 */

export type AssignmentMethod = 'round_robin' | 'load_balanced' | 'skill_based' | 'random'

export interface AssignmentRule {
  id: string
  name: string
  projectId: string | null
  method: AssignmentMethod
  assigneePool: string[]
  /** { labels: [...], priority: [...] } — all present keys must match. */
  conditions: Record<string, unknown>
  config: Record<string, unknown>
}

export interface CandidateTask {
  id: string
  projectId: string
  priority: string
  labelNames: string[]
}

/** What the engine knows about a possible assignee. */
export interface Candidate {
  userId: string
  /** Tasks currently open (not done or cancelled). */
  openTasks: number
  /** Lowercased skills from the employee record, if there is one. */
  skills: string[]
  /** True when approved leave covers today. */
  onLeave: boolean
  /**
   * Whether they are actually on the project the task belongs to.
   *
   * A rule's pool is a list of people, written once; projects change under it.
   * Assigning work to someone who cannot open the task is worse than leaving it
   * unassigned, because it looks handled.
   */
  isProjectMember: boolean
  /** Org rank, so members can be preferred over managers. */
  orgRole: 'owner' | 'admin' | 'manager' | 'member'
}

/** The project's own auto-assignment policy (`projects.settings`). */
export interface AssignmentPolicy {
  autoAssign: boolean
  autoAssignManagers: boolean
}

export const DEFAULT_ASSIGNMENT_POLICY: AssignmentPolicy = {
  autoAssign: true,
  autoAssignManagers: true,
}

/** Everyone above `member` runs projects rather than working tickets on them. */
function isManagerRole(candidate: Candidate): boolean {
  return candidate.orgRole !== 'member'
}

/**
 * Narrow a pool to who may actually take this task, in preference order.
 *
 * Two rules, in this order:
 *
 *   1. Project membership is a hard filter. Not a preference — someone who is
 *      not on the project cannot see the task, so assigning it to them silently
 *      strands the work.
 *   2. Members come first. Managers are a fallback, used only when no member is
 *      available, and only when the project allows it at all. A project run by
 *      managers still assigns; a project with members stops handing work to the
 *      people meant to be directing it.
 */
export function eligiblePool(
  pool: Candidate[],
  policy: AssignmentPolicy = DEFAULT_ASSIGNMENT_POLICY,
): Candidate[] {
  const onProject = pool.filter((candidate) => candidate.isProjectMember)
  if (onProject.length === 0) return []

  const members = onProject.filter((candidate) => !isManagerRole(candidate))
  if (members.length > 0) return members

  return policy.autoAssignManagers ? onProject : []
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Whether a rule applies to a task.
 *
 * An absent condition key means "no constraint", not "matches nothing" — a rule
 * with empty conditions is a catch-all, which is the useful default.
 */
export function ruleMatches(rule: AssignmentRule, task: CandidateTask): boolean {
  if (rule.projectId && rule.projectId !== task.projectId) return false

  const priorities = asStringArray(rule.conditions.priority)
  if (priorities.length > 0 && !priorities.includes(task.priority)) return false

  const labels = asStringArray(rule.conditions.labels)
  if (labels.length > 0) {
    const taskLabels = task.labelNames.map((name) => name.toLowerCase())
    // Any-of, not all-of: a rule for ["bug","regression"] should catch a task
    // labelled just "bug".
    const hit = labels.some((label) => taskLabels.includes(label.toLowerCase()))
    if (!hit) return false
  }

  return true
}

export interface AssignmentDecision {
  userId: string
  /** Round robin advances a cursor that has to be written back. */
  nextConfig?: Record<string, unknown>
}

/**
 * Choose an assignee, or null when the rule cannot place this task.
 *
 * `random` takes an injected picker so the caller can seed it in tests; it
 * defaults to Math.random in production.
 */
export function chooseAssignee(
  rule: AssignmentRule,
  task: CandidateTask,
  candidates: Candidate[],
  random: () => number = Math.random,
  policy: AssignmentPolicy = DEFAULT_ASSIGNMENT_POLICY,
): AssignmentDecision | null {
  // A project can switch auto-assignment off entirely without anyone having to
  // find and disable every rule that might reach it.
  if (!policy.autoAssign) return null

  // The pool is the rule's list, narrowed to people the caller could resolve,
  // then to who may actually take work on this project.
  const resolved = rule.assigneePool
    .map((userId) => candidates.find((candidate) => candidate.userId === userId))
    .filter((candidate): candidate is Candidate => candidate !== undefined)

  const pool = eligiblePool(resolved, policy)

  if (pool.length === 0) return null

  const respectLeave = rule.config.respect_leave !== false
  // Skipping people who are away is the point of the flag; if that empties the
  // pool, fall back to everyone rather than silently assigning nobody.
  const available = respectLeave ? pool.filter((candidate) => !candidate.onLeave) : pool
  const eligible = available.length > 0 ? available : pool

  switch (rule.method) {
    case 'round_robin': {
      const lastIndex =
        typeof rule.config.last_index === 'number' ? rule.config.last_index : -1
      // Cycle over the RULE's ordering, not the filtered list, so the rotation
      // stays stable as people go on and off leave.
      for (let step = 1; step <= rule.assigneePool.length; step += 1) {
        const index = (lastIndex + step) % rule.assigneePool.length
        const userId = rule.assigneePool[index]!
        // `eligible` is already narrowed to project members and, where members
        // exist, to members only — so the rotation skips anyone the project
        // rules exclude rather than stalling on them.
        if (eligible.some((candidate) => candidate.userId === userId)) {
          return { userId, nextConfig: { ...rule.config, last_index: index } }
        }
      }
      return null
    }

    case 'load_balanced': {
      const cap =
        typeof rule.config.max_concurrent === 'number' ? rule.config.max_concurrent : null
      const underCap = cap === null ? eligible : eligible.filter((c) => c.openTasks < cap)
      if (underCap.length === 0) return null

      // Ties break on the pool's own order, so the result is deterministic
      // rather than depending on however the rows came back.
      const order = new Map(rule.assigneePool.map((userId, index) => [userId, index]))
      const best = [...underCap].sort(
        (a, b) =>
          a.openTasks - b.openTasks ||
          (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0),
      )[0]!
      return { userId: best.userId }
    }

    case 'skill_based': {
      const required = asStringArray(rule.config.required_skills).map((s) => s.toLowerCase())
      // With no skills configured the rule cannot discriminate, so it behaves
      // as its fallback rather than assigning arbitrarily.
      const matched =
        required.length === 0
          ? []
          : eligible.filter((candidate) =>
              required.every((skill) => candidate.skills.includes(skill)),
            )

      if (matched.length > 0) {
        // Among equally skilled people, spread the load.
        const order = new Map(rule.assigneePool.map((userId, index) => [userId, index]))
        const best = [...matched].sort(
          (a, b) =>
            a.openTasks - b.openTasks ||
            (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0),
        )[0]!
        return { userId: best.userId }
      }

      const fallback = rule.config.fallback
      if (fallback === 'round_robin' || fallback === 'load_balanced' || fallback === 'random') {
        return chooseAssignee({ ...rule, method: fallback }, task, candidates, random, policy)
      }
      return null
    }

    case 'random': {
      const index = Math.floor(random() * eligible.length)
      // Math.random() can return values that floor to length on the boundary.
      return { userId: eligible[Math.min(index, eligible.length - 1)]!.userId }
    }

    default:
      return null
  }
}

/**
 * The first rule that applies to a task.
 *
 * Project-specific rules win over workspace-wide ones; ties break on name so
 * the outcome does not depend on row order.
 */
export function ruleFor(rules: AssignmentRule[], task: CandidateTask): AssignmentRule | null {
  const matching = rules.filter((rule) => ruleMatches(rule, task))
  if (matching.length === 0) return null

  return [...matching].sort((a, b) => {
    const specificity = Number(Boolean(b.projectId)) - Number(Boolean(a.projectId))
    return specificity !== 0 ? specificity : a.name.localeCompare(b.name)
  })[0]!
}
