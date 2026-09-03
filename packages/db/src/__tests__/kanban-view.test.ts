import { describe, expect, it } from 'vitest'
import {
  columnKeyFor,
  deriveColumns,
  patchForDrop,
  type GroupableTask,
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
