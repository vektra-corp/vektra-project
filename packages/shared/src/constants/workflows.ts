/**
 * Workflow graph model (claude.md §11).
 *
 * The graph is stored as one `jsonb` blob, so every rule about its shape lives
 * here rather than in a constraint. `validateGraph` is the gate: a workflow that
 * does not pass it must not be activated, because the engine's safety net (a
 * step cap) should never be what stops a malformed graph.
 *
 * Trigger types and the execution limits live in statuses.ts with the other
 * values that mirror database constraints; this module is graph shape only.
 */
import { WORKFLOW_LIMITS } from './statuses'

export const WORKFLOW_NODE_TYPES = [
  'trigger',
  'condition',
  'filter',
  'delay',
  'branch',
  'action',
] as const
export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPES)[number]

export const WORKFLOW_ACTION_TYPES = [
  'update_fields',
  'assign_task',
  'create_task',
  'send_notification',
  'add_comment',
  'add_label',
  'call_webhook',
] as const
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number]

export const WORKFLOW_ACTION_LABELS: Record<WorkflowActionType, string> = {
  update_fields: 'Update fields',
  assign_task: 'Assign to someone',
  create_task: 'Create a task',
  send_notification: 'Send a notification',
  add_comment: 'Add a comment',
  add_label: 'Add a label',
  call_webhook: 'Call a webhook',
}

export const WORKFLOW_NODE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: 'Trigger',
  condition: 'Condition',
  filter: 'Filter',
  delay: 'Delay',
  branch: 'Branch',
  action: 'Action',
}

/** Adjacency rules (§11). Enforced in the editor and again on save. */
export const VALID_NEXT_NODES: Record<WorkflowNodeType, readonly WorkflowNodeType[]> = {
  trigger: ['condition', 'filter', 'action', 'delay'],
  condition: ['action', 'condition', 'filter', 'delay', 'branch'],
  filter: ['action', 'condition', 'delay'],
  action: ['action', 'condition', 'filter', 'delay', 'branch'],
  delay: ['action', 'condition', 'filter'],
  branch: ['action', 'condition', 'filter', 'delay'],
}

export interface WorkflowNode {
  id: string
  type: WorkflowNodeType
  action_type?: WorkflowActionType
  config: Record<string, unknown>
  position: { x: number; y: number }
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  /** 'yes' / 'no' out of a condition; a branch key out of a branch. */
  label?: string
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] }

export interface GraphProblem {
  /** Node or edge id, when the problem is local to one. */
  at?: string
  message: string
}

function isNodeType(value: unknown): value is WorkflowNodeType {
  return typeof value === 'string' && (WORKFLOW_NODE_TYPES as readonly string[]).includes(value)
}

/** Parse stored jsonb into a graph, discarding anything malformed. */
export function parseGraph(raw: unknown): WorkflowGraph {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_GRAPH }
  const source = raw as Record<string, unknown>

  const nodes: WorkflowNode[] = Array.isArray(source.nodes)
    ? source.nodes.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const node = entry as Record<string, unknown>
        if (typeof node.id !== 'string' || !isNodeType(node.type)) return []

        const position = (node.position ?? {}) as Record<string, unknown>
        return [
          {
            id: node.id,
            type: node.type,
            action_type:
              typeof node.action_type === 'string' &&
              (WORKFLOW_ACTION_TYPES as readonly string[]).includes(node.action_type)
                ? (node.action_type as WorkflowActionType)
                : undefined,
            config:
              node.config && typeof node.config === 'object'
                ? (node.config as Record<string, unknown>)
                : {},
            position: {
              x: typeof position.x === 'number' ? position.x : 0,
              y: typeof position.y === 'number' ? position.y : 0,
            },
          },
        ]
      })
    : []

  const ids = new Set(nodes.map((node) => node.id))

  const edges: WorkflowEdge[] = Array.isArray(source.edges)
    ? source.edges.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return []
        const edge = entry as Record<string, unknown>
        if (typeof edge.source !== 'string' || typeof edge.target !== 'string') return []
        // An edge to a node that no longer exists would render as a line into
        // nowhere and confuse the walker.
        if (!ids.has(edge.source) || !ids.has(edge.target)) return []
        return [
          {
            id: typeof edge.id === 'string' ? edge.id : `${edge.source}->${edge.target}`,
            source: edge.source,
            target: edge.target,
            label: typeof edge.label === 'string' ? edge.label : undefined,
          },
        ]
      })
    : []

  return { nodes, edges }
}

/**
 * Every problem that would stop a workflow running correctly.
 *
 * Returns all of them rather than the first, so the editor can mark every bad
 * node at once instead of making someone fix them one save at a time.
 */
export function validateGraph(graph: WorkflowGraph): GraphProblem[] {
  const problems: GraphProblem[] = []

  const triggers = graph.nodes.filter((node) => node.type === 'trigger')
  if (triggers.length === 0) {
    problems.push({ message: 'The workflow needs a trigger to start from.' })
  }
  if (triggers.length > 1) {
    problems.push({ message: 'A workflow can only have one trigger.' })
  }

  if (graph.nodes.length > WORKFLOW_LIMITS.MAX_NODES) {
    problems.push({
      message: `A workflow can hold at most ${WORKFLOW_LIMITS.MAX_NODES} nodes.`,
    })
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))

  for (const edge of graph.edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue

    if (target.type === 'trigger') {
      problems.push({ at: edge.id, message: 'Nothing can lead back into the trigger.' })
      continue
    }

    const allowed = VALID_NEXT_NODES[source.type]
    if (!allowed.includes(target.type)) {
      problems.push({
        at: edge.id,
        message: `A ${WORKFLOW_NODE_LABELS[source.type].toLowerCase()} cannot lead to a ${WORKFLOW_NODE_LABELS[target.type].toLowerCase()}.`,
      })
    }
  }

  // An action node with no action type does nothing at run time.
  for (const node of graph.nodes) {
    if (node.type === 'action' && !node.action_type) {
      problems.push({ at: node.id, message: 'This action has no action type set.' })
    }
    if (node.type === 'delay' && typeof node.config.duration !== 'string') {
      problems.push({ at: node.id, message: 'This delay has no duration set.' })
    }
  }

  // Unreachable nodes are almost always a half-finished edit, and they silently
  // never run.
  if (triggers.length === 1) {
    const reachable = reachableFrom(graph, triggers[0]!.id)
    for (const node of graph.nodes) {
      if (node.type !== 'trigger' && !reachable.has(node.id)) {
        problems.push({ at: node.id, message: 'Nothing leads to this node, so it never runs.' })
      }
    }
  }

  for (const cycle of findCycles(graph)) {
    problems.push({ at: cycle, message: 'This node is part of a loop.' })
  }

  return problems
}

/** Node ids reachable from `startId`, following edges forwards. */
export function reachableFrom(graph: WorkflowGraph, startId: string): Set<string> {
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const seen = new Set<string>()
  const queue = [startId]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const next of outgoing.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }

  return seen
}

/**
 * Node ids that sit on a cycle.
 *
 * The engine caps steps at 50, but that cap is a safety net against runaway
 * cost — it is not an acceptable way to discover that a graph loops. A cycle is
 * refused at save time.
 */
export function findCycles(graph: WorkflowGraph): string[] {
  const outgoing = new Map<string, string[]>()
  for (const edge of graph.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const colour = new Map<string, number>(graph.nodes.map((node) => [node.id, WHITE]))
  const onCycle = new Set<string>()

  const visit = (id: string, stack: string[]): void => {
    colour.set(id, GREY)
    for (const next of outgoing.get(id) ?? []) {
      const state = colour.get(next) ?? WHITE
      if (state === GREY) {
        // Everything from `next` to here is part of the loop.
        const from = stack.indexOf(next)
        for (const member of stack.slice(from === -1 ? 0 : from)) onCycle.add(member)
        onCycle.add(next)
      } else if (state === WHITE) {
        visit(next, [...stack, next])
      }
    }
    colour.set(id, BLACK)
  }

  for (const node of graph.nodes) {
    if ((colour.get(node.id) ?? WHITE) === WHITE) visit(node.id, [node.id])
  }

  return [...onCycle]
}

/** The order the engine would walk the graph in, from the trigger. */
export function executionOrder(graph: WorkflowGraph): WorkflowNode[] {
  const trigger = graph.nodes.find((node) => node.type === 'trigger')
  if (!trigger) return []

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const reachable = reachableFrom(graph, trigger.id)

  return [trigger, ...[...reachable].map((id) => byId.get(id)).filter(Boolean)] as WorkflowNode[]
}

// --- delays -------------------------------------------------------------------

/**
 * How long a delay node waits, in seconds.
 *
 * The editor writes a duration string (`30m`, `2h`, `3d`); anything unparseable
 * yields null so the runner can log why it skipped rather than guessing a wait.
 * The ceiling matters: a delay holds a workflow run open, and an unbounded one
 * is a resource leak with no way to see it. Thirty days is the cap.
 *
 * Note this is wall-clock, not the §18 five-minute runtime budget — that budget
 * governs compute, and a delay is by definition not computing.
 */
export const MAX_DELAY_SECONDS = 30 * 24 * 60 * 60

const DELAY_UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }

export function parseDelaySeconds(config: Record<string, unknown>): number | null {
  const raw = config.duration
  if (typeof raw !== 'string') return null

  const match = /^\s*(\d+)\s*([smhd])\s*$/i.exec(raw)
  if (!match) return null

  const amount = Number(match[1])
  const unit = DELAY_UNITS[match[2]!.toLowerCase()]
  if (!Number.isFinite(amount) || amount <= 0 || !unit) return null

  return Math.min(amount * unit, MAX_DELAY_SECONDS)
}

// --- branches -----------------------------------------------------------------

/**
 * Which edge label a branch node takes for a given value.
 *
 * A branch is a switch, not a fan-out: exactly one case wins. Matching is on the
 * stringified value because the case comes from a text input while the payload
 * carries a real type. When nothing matches, the `default` edge takes over — and
 * if there is no default edge, the branch simply ends, which is why the editor
 * warns about a branch with no default.
 */
export const BRANCH_DEFAULT_LABEL = 'default'

export function branchLabelFor(value: unknown, cases: readonly string[]): string {
  const needle = value === null || value === undefined ? '' : String(value)
  const hit = cases.find((entry) => entry === needle)
  return hit ?? BRANCH_DEFAULT_LABEL
}

/** The case labels a branch node declares, in editor order. */
export function branchCases(config: Record<string, unknown>): string[] {
  const raw = config.cases
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== BRANCH_DEFAULT_LABEL)
}
