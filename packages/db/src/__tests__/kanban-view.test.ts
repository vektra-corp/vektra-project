import type { KanbanViewConfig } from '@pm/shared/constants'
import { describe, expect, it } from 'vitest'
import {
  columnKeyFor,
  deriveColumns,
  patchForDrop,
  sortForView,
  type GroupableTask,
  type SortableTask,
} from '../services/kanban-view'

/** Board grouping logic (claude.md §19.8). Pure functions, so tested directly. */

const realColumns = [
  { id: 'c1', name: 'To Do', color: null, position: 0, wip_limit: null, is_done_column: false, status: 'todo' },
  { id: 'c2', name: 'Done', color: null, position: 1, wip_limit: 2, is_done_column: true, status: 'done' },
]

const tasks: GroupableTask[] = [
  {
    id: 't1', status: 'todo', priority: 'high', kanban_column_id: 'c1',
    assignee: { id: 'u1', full_name: 'Zoe Alpha' },
    labels: [{ id: 'l1', name: 'Bug', color: '#f00' }],
  },
  {
    id: 't2', status: 'done', priority: 'low', kanban_column_id: 'c2',
    assignee: { id: 'u2', full_name: 'Adam Beta' },
    labels: [],
  },
  {
    id: 't3', status: 'todo', priority: 'high', kanban_column_id: 'c1',
    assignee: null,
    labels: [],
  },
]

const view = (group_by: never) => ({ group_by, show_empty_columns: true })

describe('deriveColumns', () => {
  it('uses the real board columns when grouping by status', () => {
    const columns = deriveColumns(view('status' as never), realColumns, tasks)
    expect(columns.map((c) => c.id)).toEqual(['c1', 'c2'])
    // WIP limits only exist on real columns.
    expect(columns[1]?.wip_limit).toBe(2)
  })

  it('produces one column per priority, in severity order', () => {
    const columns = deriveColumns(view('priority' as never), realColumns, tasks)
    expect(columns.map((c) => c.value)).toEqual(['critical', 'high', 'medium', 'low'])
  })

  it('groups by assignee, name-sorted, with Unassigned always last', () => {
    const columns = deriveColumns(view('assignee' as never), realColumns, tasks)
    expect(columns.map((c) => c.name)).toEqual(['Adam Beta', 'Zoe Alpha', 'Unassigned'])
    expect(columns.at(-1)?.value).toBeNull()
  })

  it('always offers Unassigned even when everyone has work', () => {
    const assigned = tasks.filter((t) => t.assignee)
    const columns = deriveColumns(view('assignee' as never), realColumns, assigned)
    expect(columns.some((c) => c.id === 'assignee:none')).toBe(true)
  })

  it('groups by label with a "No label" catch-all', () => {
    const columns = deriveColumns(view('label' as never), realColumns, tasks)
    expect(columns.map((c) => c.name)).toEqual(['Bug', 'No label'])
  })
})

describe('columnKeyFor', () => {
  it('maps each task to its column under every grouping', () => {
    expect(columnKeyFor('status', tasks[0]!)).toBe('c1')
    expect(columnKeyFor('priority', tasks[0]!)).toBe('priority:high')
    expect(columnKeyFor('assignee', tasks[0]!)).toBe('assignee:u1')
    expect(columnKeyFor('assignee', tasks[2]!)).toBe('assignee:none')
    expect(columnKeyFor('label', tasks[1]!)).toBe('label:none')
  })
})

describe('patchForDrop', () => {
  it('moves column and status together when grouping by status (business rule 3)', () => {
    const columns = deriveColumns(view('status' as never), realColumns, tasks)
    expect(patchForDrop('status', columns[1]!)).toEqual({
      kanban_column_id: 'c2',
      status: 'done',
    })
  })

  it('changes the grouped attribute, not the column, in other modes', () => {
    const byPriority = deriveColumns(view('priority' as never), realColumns, tasks)
    expect(patchForDrop('priority', byPriority[0]!)).toEqual({ priority: 'critical' })

    const byAssignee = deriveColumns(view('assignee' as never), realColumns, tasks)
    expect(patchForDrop('assignee', byAssignee[0]!)).toEqual({ assignee_id: 'u2' })
  })

  it('unassigns when dropped on the Unassigned column', () => {
    const byAssignee = deriveColumns(view('assignee' as never), realColumns, tasks)
    expect(patchForDrop('assignee', byAssignee.at(-1)!)).toEqual({ assignee_id: null })
  })

  it('refuses drops it cannot express as a task update', () => {
    const byLabel = deriveColumns(view('label' as never), realColumns, tasks)
    expect(patchForDrop('label', byLabel[0]!)).toBeNull()
  })
})

describe('sortForView', () => {
  const card = (over: Partial<SortableTask> = {}): SortableTask => ({
    position: 0,
    priority: 'medium',
    due_date: null,
    title: 'Task',
    task_number: 1,
    ...over,
  })

  const view = (
    sort_by: KanbanViewConfig['sort_by'],
    sort_order: 'asc' | 'desc' = 'asc',
  ): Pick<KanbanViewConfig, 'sort_by' | 'sort_order'> => ({ sort_by, sort_order })

  it('orders by position by default and does not mutate the input', () => {
    const input = [card({ position: 3 }), card({ position: 1 }), card({ position: 2 })]
    const output = sortForView(input, view('position'))

    expect(output.map((c) => c.position)).toEqual([1, 2, 3])
    expect(input.map((c) => c.position)).toEqual([3, 1, 2])
  })

  it('orders by priority with urgent first', () => {
    const input = [card({ priority: 'low' }), card({ priority: 'critical' }), card({ priority: 'high' })]
    expect(sortForView(input, view('priority')).map((c) => c.priority)).toEqual([
      'critical',
      'high',
      'low',
    ])
  })

  it('keeps undated work last in BOTH sort directions', () => {
    const input = [
      card({ due_date: null, title: 'no date' }),
      card({ due_date: '2026-01-05', title: 'later' }),
      card({ due_date: '2026-01-01', title: 'sooner' }),
    ]

    expect(sortForView(input, view('due_date', 'asc')).map((c) => c.title)).toEqual([
      'sooner',
      'later',
      'no date',
    ])
    // Descending must not float the undated card to the top: it has no date to
    // compare, it is not "the furthest future".
    expect(sortForView(input, view('due_date', 'desc')).map((c) => c.title)).toEqual([
      'later',
      'sooner',
      'no date',
    ])
  })

  it('uses task_number as the creation-order proxy', () => {
    const input = [card({ task_number: 9 }), card({ task_number: 2 }), card({ task_number: 5 })]
    expect(sortForView(input, view('created_at')).map((c) => c.task_number)).toEqual([2, 5, 9])
    expect(sortForView(input, view('created_at', 'desc')).map((c) => c.task_number)).toEqual([
      9, 5, 2,
    ])
  })

  it('sorts an unknown priority last rather than throwing', () => {
    const input = [card({ priority: 'bogus' }), card({ priority: 'high' })]
    expect(sortForView(input, view('priority')).map((c) => c.priority)).toEqual(['high', 'bogus'])
  })
})
