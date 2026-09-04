import { parseGraph } from '@pm/shared/constants'
import { describe, expect, it } from 'vitest'
import {
  evaluateCondition,
  nextNodes,
  planExecution,
  readField,
  triggerMatches,
} from '../services/workflow-engine'

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

/** The payload shape emit_event actually writes. */
const taskPayload = (fields: Record<string, unknown>) => ({
  table: 'tasks',
  operation: 'UPDATE',
  new: fields,
  old: {},
})

describe('readField', () => {
  it('finds a field inside the row snapshot without being told where', () => {
    // Conditions are authored as "status", not "new.status".
    expect(readField(taskPayload({ status: 'done' }), 'status')).toBe('done')
  })

  it('still honours an explicit dotted path', () => {
    expect(readField(taskPayload({ status: 'done' }), 'new.status')).toBe('done')
    expect(readField({ table: 'tasks' }, 'table')).toBe('tasks')
  })

  it('falls back to the old row when the new one lacks the field', () => {
    expect(readField({ new: {}, old: { status: 'todo' } }, 'status')).toBe('todo')
  })

  it('returns undefined rather than throwing on a missing path', () => {
    expect(readField({}, 'a.b.c')).toBeUndefined()
    expect(readField({ new: null }, 'status')).toBeUndefined()
    expect(readField({}, '')).toBeUndefined()
  })
})

describe('evaluateCondition', () => {
  it('compares as strings so form input matches typed payload values', () => {
    const n = node('c', 'condition', { config: { field: 'estimated_hours', equals: '5' } })
    expect(evaluateCondition(n as never, taskPayload({ estimated_hours: 5 }))).toBe('yes')
  })

  it('is no when the field does not match', () => {
    const n = node('c', 'condition', { config: { field: 'status', equals: 'done' } })
    expect(evaluateCondition(n as never, taskPayload({ status: 'todo' }))).toBe('no')
  })

  it('is no when unconfigured, rather than waving everything through', () => {
    expect(evaluateCondition(node('c', 'condition') as never, taskPayload({}))).toBe('no')
    expect(
      evaluateCondition(
        node('c', 'condition', { config: { field: 'status' } }) as never,
        taskPayload({ status: 'todo' }),
      ),
    ).toBe('no')
  })

  it('is no when the field is absent or null', () => {
    const n = node('c', 'condition', { config: { field: 'status', equals: 'done' } })
    expect(evaluateCondition(n as never, taskPayload({}))).toBe('no')
    expect(evaluateCondition(n as never, taskPayload({ status: null }))).toBe('no')
  })
})

describe('nextNodes', () => {
  const graph = parseGraph({
    nodes: [node('c', 'condition'), node('a', 'action'), node('b', 'action')],
    edges: [edge('c', 'a', 'yes'), edge('c', 'b', 'no')],
  })

  it('follows only the matching branch', () => {
    expect(nextNodes(graph, 'c', 'yes')).toEqual(['a'])
    expect(nextNodes(graph, 'c', 'no')).toEqual(['b'])
  })

  it('follows every edge when there is no outcome', () => {
    expect(nextNodes(graph, 'c').sort()).toEqual(['a', 'b'])
  })

  it('treats an unlabelled edge out of a condition as the yes path', () => {
    const single = parseGraph({
      nodes: [node('c', 'condition'), node('a', 'action')],
      edges: [edge('c', 'a')],
    })
    expect(nextNodes(single, 'c', 'yes')).toEqual(['a'])
    expect(nextNodes(single, 'c', 'no')).toEqual([])
  })
})

describe('planExecution', () => {
  it('returns nothing without a trigger', () => {
    const graph = parseGraph({ nodes: [node('a', 'action')], edges: [] })
    expect(planExecution(graph, {}).steps).toEqual([])
  })

  it('walks a straight line', () => {
    const graph = parseGraph({
      nodes: [node('t', 'trigger'), node('a', 'action', { action_type: 'add_label' })],
      edges: [edge('t', 'a')],
    })
    expect(planExecution(graph, {}).steps.map((s) => s.node.id)).toEqual(['t', 'a'])
  })

  it('takes only the branch the condition selects', () => {
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('c', 'condition', { config: { field: 'status', equals: 'done' } }),
        node('yes', 'action', { action_type: 'add_label' }),
        node('no', 'action', { action_type: 'add_label' }),
      ],
      edges: [edge('t', 'c'), edge('c', 'yes', 'yes'), edge('c', 'no', 'no')],
    })

    const done = planExecution(graph, taskPayload({ status: 'done' }))
    expect(done.steps.map((s) => s.node.id)).toEqual(['t', 'c', 'yes'])

    const todo = planExecution(graph, taskPayload({ status: 'todo' }))
    expect(todo.steps.map((s) => s.node.id)).toEqual(['t', 'c', 'no'])
  })

  it('stops the branch entirely when a filter fails', () => {
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('f', 'filter', { config: { field: 'priority', equals: 'critical' } }),
        node('a', 'action', { action_type: 'add_label' }),
      ],
      edges: [edge('t', 'f'), edge('f', 'a')],
    })

    const blocked = planExecution(graph, taskPayload({ priority: 'low' }))
    expect(blocked.steps.map((s) => s.node.id)).toEqual(['t', 'f'])
    expect(blocked.steps.at(-1)?.halted).toBe(true)

    const passed = planExecution(graph, taskPayload({ priority: 'critical' }))
    expect(passed.steps.map((s) => s.node.id)).toEqual(['t', 'f', 'a'])
  })

  it('runs a rejoined tail once, not twice', () => {
    // A diamond: both branches lead to the same action.
    const graph = parseGraph({
      nodes: [
        node('t', 'trigger'),
        node('a1', 'action', { action_type: 'add_label' }),
        node('a2', 'action', { action_type: 'add_label' }),
        node('tail', 'action', { action_type: 'send_notification' }),
      ],
      edges: [edge('t', 'a1'), edge('t', 'a2'), edge('a1', 'tail'), edge('a2', 'tail')],
    })

    const ids = planExecution(graph, {}).steps.map((s) => s.node.id)
    expect(ids.filter((id) => id === 'tail')).toHaveLength(1)
  })

  it('stops at the step cap even if a graph somehow loops', () => {
    // Cycles are refused at save time, but a row edited directly in the
    // database must still be bounded.
    const nodes = [node('t', 'trigger')]
    const edges = [edge('t', 'n0')]
    for (let i = 0; i < 60; i += 1) {
      nodes.push(node(`n${i}`, 'action', { action_type: 'add_label' }))
      edges.push(edge(`n${i}`, `n${i + 1}`))
    }
    nodes.push(node('n60', 'action', { action_type: 'add_label' }))

    const plan = planExecution(parseGraph({ nodes, edges }), {})
    expect(plan.truncated).toBe(true)
    expect(plan.steps.length).toBeLessThanOrEqual(50)
  })
})

describe('triggerMatches', () => {
  const event = { id: 'e1', eventType: 'tasks.update', payload: { table: 'tasks' } }

  it('matches an event to its table family', () => {
    expect(triggerMatches('task_event', {}, event)).toBe(true)
    expect(triggerMatches('subtask_event', {}, event)).toBe(false)
  })

  it('never matches a trigger that is not event-driven', () => {
    for (const type of ['webhook', 'schedule', 'manual']) {
      expect(triggerMatches(type, {}, event)).toBe(false)
    }
  })

  it('honours an optional event-type filter', () => {
    expect(triggerMatches('task_event', { event_types: ['tasks.insert'] }, event)).toBe(false)
    expect(triggerMatches('task_event', { event_types: ['tasks.update'] }, event)).toBe(true)
    // An empty list is no filter, not an impossible one.
    expect(triggerMatches('task_event', { event_types: [] }, event)).toBe(true)
  })
})
