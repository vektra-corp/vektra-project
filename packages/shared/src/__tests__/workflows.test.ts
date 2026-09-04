import { describe, expect, it } from 'vitest'
import {
  executionOrder,
  findCycles,
  parseGraph,
  reachableFrom,
  validateGraph,
  type WorkflowGraph,
} from '../constants/workflows'

const node = (id: string, type: string, over: Record<string, unknown> = {}) => ({
  id,
  type,
  config: {},
  position: { x: 0, y: 0 },
  ...over,
})

const edge = (source: string, target: string, label?: string) => ({
  id: `${source}->${target}`,
  source,
  target,
  ...(label ? { label } : {}),
})

/** Trigger → condition → action, the smallest valid workflow. */
const linear = (): WorkflowGraph =>
  parseGraph({
    nodes: [
      node('t', 'trigger'),
      node('c', 'condition'),
      node('a', 'action', { action_type: 'assign_task' }),
    ],
    edges: [edge('t', 'c'), edge('c', 'a', 'yes')],
  })

describe('parseGraph', () => {
  it('discards nodes with no id or an unknown type', () => {
    const graph = parseGraph({
      nodes: [node('a', 'action', { action_type: 'add_label' }), { type: 'action' }, node('x', 'wat')],
      edges: [],
    })
    expect(graph.nodes.map((n) => n.id)).toEqual(['a'])
  })

  it('drops edges pointing at nodes that no longer exist', () => {
    // A dangling edge would draw a line into nowhere and confuse the walker.
    const graph = parseGraph({
      nodes: [node('t', 'trigger')],
      edges: [edge('t', 'ghost'), edge('ghost', 't')],
    })
    expect(graph.edges).toEqual([])
  })

  it('survives junk without throwing', () => {
    expect(parseGraph(null).nodes).toEqual([])
    expect(parseGraph('[]').nodes).toEqual([])
    expect(parseGraph({ nodes: 'no', edges: 7 }).edges).toEqual([])
  })

  it('defaults a missing position rather than dropping the node', () => {
    const graph = parseGraph({ nodes: [node('t', 'trigger', { position: undefined })], edges: [] })
    expect(graph.nodes[0]?.position).toEqual({ x: 0, y: 0 })
  })
})

describe('validateGraph', () => {
  it('accepts a minimal valid workflow', () => {
    expect(validateGraph(linear())).toEqual([])
  })

  it('requires exactly one trigger', () => {
    const none = parseGraph({ nodes: [node('a', 'action', { action_type: 'add_label' })], edges: [] })
    expect(validateGraph(none).some((p) => p.message.includes('needs a trigger'))).toBe(true)

    const two = parseGraph({
      nodes: [node('t1', 'trigger'), node('t2', 'trigger')],
      edges: [],
    })
    expect(validateGraph(two).some((p) => p.message.includes('only have one trigger'))).toBe(true)
  })

  it('enforces the adjacency rules', () => {
    // trigger -> branch is not allowed (§11).
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('b', 'branch')],
      edges: [edge('t', 'b')],
    })
    expect(validateGraph(graph).some((p) => p.message.includes('cannot lead to'))).toBe(true)
  })

  it('refuses an edge back into the trigger', () => {
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('a', 'action', { action_type: 'add_label' })],
      edges: [edge('t', 'a'), edge('a', 't')],
    })
    expect(validateGraph(graph).some((p) => p.message.includes('back into the trigger'))).toBe(true)
  })

  it('flags an action with no action type', () => {
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('a', 'action')],
      edges: [edge('t', 'a')],
    })
    expect(validateGraph(graph).some((p) => p.message.includes('no action type'))).toBe(true)
  })

  it('flags a delay with no duration', () => {
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('d', 'delay')],
      edges: [edge('t', 'd')],
    })
    expect(validateGraph(graph).some((p) => p.message.includes('no duration'))).toBe(true)
  })

  it('flags an unreachable node', () => {
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('a', 'action', { action_type: 'add_label' }),
        node('orphan', 'action', { action_type: 'add_label' }),
      ],
      edges: [edge('t', 'a')],
    })
    const problems = validateGraph(graph)
    expect(problems.some((p) => p.at === 'orphan' && p.message.includes('never runs'))).toBe(true)
  })

  it('reports every problem, not just the first', () => {
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('a', 'action'), node('d', 'delay')],
      edges: [edge('t', 'a'), edge('a', 'd')],
    })
    // Missing action type AND missing delay duration.
    expect(validateGraph(graph).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a graph over the node cap', () => {
    const nodes = [node('t', 'trigger')]
    for (let i = 0; i < 45; i += 1) {
      nodes.push(node(`a${i}`, 'action', { action_type: 'add_label' }))
    }
    const graph = parseGraph({ nodes, edges: [] })
    expect(validateGraph(graph).some((p) => p.message.includes('at most'))).toBe(true)
  })
})

describe('findCycles', () => {
  it('finds nothing in a straight line', () => {
    expect(findCycles(linear())).toEqual([])
  })

  it('detects a loop and names its members', () => {
    // The engine caps steps at 50, but that is a cost guard — a loop must be
    // refused at save time, not discovered at run time.
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('a', 'action', { action_type: 'add_label' }),
        node('b', 'action', { action_type: 'add_label' }),
      ],
      edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')],
    })
    const cycle = findCycles(graph)
    expect(cycle).toContain('a')
    expect(cycle).toContain('b')
    expect(cycle).not.toContain('t')
  })

  it('detects a self-loop', () => {
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('a', 'action', { action_type: 'add_label' })],
      edges: [edge('t', 'a'), edge('a', 'a')],
    })
    expect(findCycles(graph)).toContain('a')
  })

  it('surfaces the loop through validateGraph too', () => {
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('a', 'action', { action_type: 'add_label' }),
        node('b', 'action', { action_type: 'add_label' }),
      ],
      edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')],
    })
    expect(validateGraph(graph).some((p) => p.message.includes('loop'))).toBe(true)
  })

  it('does not mistake a diamond for a cycle', () => {
    // Two paths that rejoin is a normal shape, not a loop.
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('c', 'condition'),
        node('a1', 'action', { action_type: 'add_label' }),
        node('a2', 'action', { action_type: 'add_label' }),
      ],
      edges: [edge('t', 'c'), edge('c', 'a1', 'yes'), edge('c', 'a2', 'no'), edge('a1', 'a2')],
    })
    expect(findCycles(graph)).toEqual([])
  })
})

describe('reachableFrom / executionOrder', () => {
  it('walks forwards only', () => {
    const reachable = reachableFrom(linear(), 't')
    expect([...reachable].sort()).toEqual(['a', 'c'])
  })

  it('starts the execution order at the trigger', () => {
    expect(executionOrder(linear())[0]?.type).toBe('trigger')
  })

  it('returns nothing without a trigger', () => {
    const graph = parseGraph({ nodes: [node('a', 'action')], edges: [] })
    expect(executionOrder(graph)).toEqual([])
  })
})
