import {
  BRANCH_DEFAULT_LABEL,
  WORKFLOW_LIMITS,
  branchCases,
  branchLabelFor,
  parseDelaySeconds,
  type WorkflowGraph,
  type WorkflowNode,
} from '@pm/shared/constants'

/**
 * Workflow execution (claude.md §11, §18 rule 8).
 *
 * The walk and the condition evaluation are pure so they can be reasoned about
 * without a job runner or a database. The Inngest function supplies the event
 * payload and performs the side effects; everything about *which* nodes run,
 * and in what order, is decided here.
 */

export interface TriggerEvent {
  id: string
  eventType: string
  payload: Record<string, unknown>
}

export type ConditionOutcome = 'yes' | 'no'

/**
 * Read a dotted path out of the event payload.
 *
 * Events wrap the row under `new` / `old`, so a condition on `status` should
 * find `payload.new.status` without the author having to know that. An explicit
 * dotted path still wins.
 */
export function readField(payload: Record<string, unknown>, field: string): unknown {
  if (!field) return undefined

  const walk = (source: unknown, path: string[]): unknown => {
    let current = source
    for (const segment of path) {
      if (current === null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[segment]
    }
    return current
  }

  const path = field.split('.')
  const direct = walk(payload, path)
  if (direct !== undefined) return direct

  // Fall back to the row snapshot, which is where task fields actually live.
  const fromNew = walk(payload.new, path)
  if (fromNew !== undefined) return fromNew
  return walk(payload.old, path)
}

/**
 * Evaluate a condition or filter node.
 *
 * Comparison is stringified on both sides: config comes from a text input, so
 * `"5"` from the form and `5` from the payload must be treated as equal. A node
 * with no field configured yields `no` — an unconfigured condition should stop
 * the branch, not wave everything through.
 */
export function evaluateCondition(
  node: WorkflowNode,
  payload: Record<string, unknown>,
): ConditionOutcome {
  const field = typeof node.config.field === 'string' ? node.config.field : ''
  if (!field) return 'no'

  const actual = readField(payload, field)
  if (actual === undefined || actual === null) return 'no'

  const expected = node.config.equals
  if (expected === undefined || expected === null || expected === '') return 'no'

  return String(actual) === String(expected) ? 'yes' : 'no'
}

/**
 * The nodes that run after `nodeId`.
 *
 * A condition follows only the edge whose label matches its outcome; an
 * unlabelled edge out of a condition is treated as the `yes` path, which is what
 * someone drawing a single line from a condition means. Everything else follows
 * all of its outgoing edges.
 */
export function nextNodes(
  graph: WorkflowGraph,
  nodeId: string,
  outcome?: ConditionOutcome,
): string[] {
  const outgoing = graph.edges.filter((edge) => edge.source === nodeId)
  if (outcome === undefined) return outgoing.map((edge) => edge.target)

  const matching = outgoing.filter((edge) => (edge.label ?? 'yes') === outcome)
  return matching.map((edge) => edge.target)
}

export interface PlannedStep {
  node: WorkflowNode
  /** Present for condition and filter nodes. */
  outcome?: ConditionOutcome
  /** True when the branch stopped here because a condition was not met. */
  halted?: boolean
  /** Present for branch nodes: the edge label that won. */
  branch?: string
  /** Present for delay nodes; null when the duration could not be read. */
  delaySeconds?: number | null
}

export interface ExecutionPlan {
  steps: PlannedStep[]
  /** True when the step cap stopped the walk before it finished. */
  truncated: boolean
}

/**
 * Walk the graph, deciding what would run for this payload.
 *
 * Separated from performing the actions so the decision is testable and so a
 * dry run is possible. Cycles are already refused at save time, but the step cap
 * is enforced here regardless: a graph saved before that check existed, or
 * edited directly in the database, must still be bounded.
 */
export function planExecution(
  graph: WorkflowGraph,
  payload: Record<string, unknown>,
): ExecutionPlan {
  const trigger = graph.nodes.find((node) => node.type === 'trigger')
  if (!trigger) return { steps: [], truncated: false }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const steps: PlannedStep[] = []
  const visited = new Set<string>()
  const queue: string[] = [trigger.id]

  while (queue.length > 0) {
    if (steps.length >= WORKFLOW_LIMITS.MAX_STEPS) {
      return { steps, truncated: true }
    }

    const nodeId = queue.shift()!
    // A diamond rejoins; running the shared tail twice would double its actions.
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = byId.get(nodeId)
    if (!node) continue

    if (node.type === 'condition' || node.type === 'filter') {
      const outcome = evaluateCondition(node, payload)
      // A filter is a gate, not a fork: failing it ends the branch entirely.
      const halted = node.type === 'filter' && outcome === 'no'
      steps.push({ node, outcome, halted })
      if (!halted) queue.push(...nextNodes(graph, nodeId, outcome))
      continue
    }

    // A branch is a switch: exactly one outgoing edge is taken, chosen by the
    // value of the configured field. Following every edge — which is what this
    // did before branches were really implemented — turns a three-way routing
    // decision into three simultaneous actions.
    if (node.type === 'branch') {
      const field = typeof node.config.field === 'string' ? node.config.field : ''
      const value = field ? readField(payload, field) : undefined
      const label = branchLabelFor(value, branchCases(node.config))

      const taken = graph.edges.filter(
        (edge) => edge.source === nodeId && (edge.label ?? BRANCH_DEFAULT_LABEL) === label,
      )

      steps.push({ node, branch: label, halted: taken.length === 0 })
      queue.push(...taken.map((edge) => edge.target))
      continue
    }

    if (node.type === 'delay') {
      steps.push({ node, delaySeconds: parseDelaySeconds(node.config) })
      queue.push(...nextNodes(graph, nodeId))
      continue
    }

    steps.push({ node })
    queue.push(...nextNodes(graph, nodeId))
  }

  return { steps, truncated: false }
}

/** Whether an event should start this workflow. */
export function triggerMatches(
  triggerType: string,
  triggerConfig: Record<string, unknown>,
  event: TriggerEvent,
): boolean {
  const family: Record<string, string> = {
    task_event: 'tasks',
    subtask_event: 'subtasks',
    commercial_event: 'commercial_documents',
  }

  const expectedTable = family[triggerType]
  // webhook, schedule and manual triggers are not event-driven at all.
  if (!expectedTable) return false

  const table = typeof event.payload.table === 'string' ? event.payload.table : ''
  if (table !== expectedTable) return false

  // An optional filter on the specific event type, e.g. only inserts.
  const wanted = triggerConfig.event_types
  if (Array.isArray(wanted) && wanted.length > 0) {
    return wanted.some((entry) => typeof entry === 'string' && entry === event.eventType)
  }

  return true
}
