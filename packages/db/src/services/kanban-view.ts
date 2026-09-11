import {
  DEFAULT_KANBAN_VIEW,
  PRIORITIES,
  PRIORITY_WEIGHT,
  type KanbanCardField,
  type KanbanViewConfig,
} from '@pm/shared/constants'
import { type Db, unwrapList, unwrapMaybe } from '../helpers'

/**
 * Deriving board columns from a view configuration (claude.md §19.8).
 *
 * Only `status` grouping corresponds to real kanban_columns rows. Every other
 * grouping produces virtual columns computed from the task set, which is why a
 * drop in those modes updates the grouped attribute rather than a column id.
 */

export interface DerivedColumn {
  /** Real kanban_columns.id when grouping by status, otherwise a synthetic key. */
  id: string
  name: string
  color: string | null
  position: number
  wip_limit: number | null
  is_done_column: boolean
  /** Present only for status grouping. */
  status?: string
  /** The attribute value this column represents (assignee id, priority, ...). */
  value: string | null
}

export interface GroupableTask {
  id: string
  status: string
  priority: string
  kanban_column_id: string | null
  assignee: { id: string; full_name: string } | null
  labels: { id: string; name: string; color: string }[]
}

/** Load the view a user should see: their default, else a shared default, else built-in. */
export async function loadView(
  db: Db,
  boardId: string,
  userId: string,
): Promise<KanbanViewConfig> {
  const mine = unwrapMaybe(
    await db
      .from('kanban_view_configs')
      .select('*')
      .eq('board_id', boardId)
      .eq('created_by', userId)
      .eq('is_default', true)
      .maybeSingle(),
  )

  const view =
    mine ??
    unwrapMaybe(
      await db
        .from('kanban_view_configs')
        .select('*')
        .eq('board_id', boardId)
        .eq('is_shared', true)
        .order('created_at')
        .limit(1)
        .maybeSingle(),
    )

  if (!view) return { id: 'default', ...DEFAULT_KANBAN_VIEW }

  return {
    id: view.id,
    name: view.name,
    is_default: view.is_default,
    is_shared: view.is_shared,
    group_by: view.group_by as KanbanViewConfig['group_by'],
    group_field_id: view.group_field_id,
    card_fields: (view.card_fields as KanbanCardField[]) ?? DEFAULT_KANBAN_VIEW.card_fields,
    card_color_by: view.card_color_by as KanbanViewConfig['card_color_by'],
    card_color_map: view.card_color_map as Record<string, string> | null,
    swimlane_by: view.swimlane_by as KanbanViewConfig['swimlane_by'],
    sort_by: view.sort_by as KanbanViewConfig['sort_by'],
    sort_order: view.sort_order as 'asc' | 'desc',
    filters: (view.filters as Record<string, unknown>) ?? {},
    show_empty_columns: view.show_empty_columns,
    show_column_count: view.show_column_count,
    compact_mode: view.compact_mode,
  }
}

export async function listViews(db: Db, boardId: string) {
  return unwrapList(
    await db
      .from('kanban_view_configs')
      .select('id, name, is_default, is_shared, group_by, created_by')
      .eq('board_id', boardId)
      .order('name'),
  )
}

/**
 * Build the columns a board should render for a given view.
 *
 * `realColumns` is only consulted for status grouping; the other modes derive
 * their columns from the tasks themselves so that, for example, grouping by
 * assignee produces one column per person who actually has work here.
 */
export function deriveColumns(
  view: Pick<KanbanViewConfig, 'group_by' | 'show_empty_columns'>,
  realColumns: readonly {
    id: string
    name: string
    color: string | null
    position: number
    wip_limit: number | null
    is_done_column: boolean
    status: string
  }[],
  tasks: readonly GroupableTask[],
): DerivedColumn[] {
  switch (view.group_by) {
    case 'status':
      return realColumns.map((column) => ({ ...column, value: column.status }))

    case 'priority':
      return PRIORITIES.map((priority, index) => ({
        id: `priority:${priority}`,
        name: priority.charAt(0).toUpperCase() + priority.slice(1),
        color: null,
        position: index,
        wip_limit: null,
        is_done_column: false,
        value: priority,
      }))

    case 'assignee': {
      const people = new Map<string, string>()
      for (const task of tasks) {
        if (task.assignee) people.set(task.assignee.id, task.assignee.full_name)
      }
      const columns: DerivedColumn[] = [...people.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name], index) => ({
          id: `assignee:${id}`,
          name,
          color: null,
          position: index,
          wip_limit: null,
          is_done_column: false,
          value: id,
        }))

      // Unassigned work is the column people most need to see, so it is always
      // present and always last.
      columns.push({
        id: 'assignee:none',
        name: 'Unassigned',
        color: null,
        position: columns.length,
        wip_limit: null,
        is_done_column: false,
        value: null,
      })
      return columns
    }

    case 'label': {
      const labels = new Map<string, { name: string; color: string }>()
      for (const task of tasks) {
        for (const label of task.labels) labels.set(label.id, label)
      }
      const columns: DerivedColumn[] = [...labels.entries()]
        .sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([id, label], index) => ({
          id: `label:${id}`,
          name: label.name,
          color: label.color,
          position: index,
          wip_limit: null,
          is_done_column: false,
          value: id,
        }))

      columns.push({
        id: 'label:none',
        name: 'No label',
        color: null,
        position: columns.length,
        wip_limit: null,
        is_done_column: false,
        value: null,
      })
      return columns
    }

    default:
      // due_date_range and custom_field grouping land with their modules.
      return realColumns.map((column) => ({ ...column, value: column.status }))
  }
}

/** Which derived column a task belongs in, under the given grouping. */
export function columnKeyFor(
  groupBy: KanbanViewConfig['group_by'],
  task: GroupableTask,
): string {
  switch (groupBy) {
    case 'status':
      return task.kanban_column_id ?? ''
    case 'priority':
      return `priority:${task.priority}`
    case 'assignee':
      return task.assignee ? `assignee:${task.assignee.id}` : 'assignee:none'
    case 'label':
      return task.labels[0] ? `label:${task.labels[0].id}` : 'label:none'
    default:
      return task.kanban_column_id ?? ''
  }
}

/**
 * The task patch a drop implies.
 *
 * Under status grouping the column id itself changes; under the others the
 * grouped attribute does. Returns null when the drop cannot be expressed as a
 * task update (dropping onto "No label", for instance).
 */
export function patchForDrop(
  groupBy: KanbanViewConfig['group_by'],
  column: DerivedColumn,
): Record<string, string | null> | null {
  switch (groupBy) {
    case 'status':
      return { kanban_column_id: column.id, status: column.status ?? 'todo' }
    case 'priority':
      return { priority: column.value ?? 'medium' }
    case 'assignee':
      return { assignee_id: column.value }
    default:
      return null
  }
}

/** The minimum a card must expose to be ordered by a view's sort. */
export interface SortableTask {
  position: number
  priority: string
  due_date: string | null
  title: string
  task_number: number
}

/** Lower sorts first. An unknown value ranks last rather than throwing. */
function priorityRank(priority: string): number {
  return PRIORITY_WEIGHT[priority as keyof typeof PRIORITY_WEIGHT] ?? 99
}

/**
 * Order cards within their column, per the view's sort.
 *
 * Undated work always sorts last, in both directions: a task with no due date
 * is not "infinitely far in the future", it simply has nothing to compare, and
 * floating it to the top of a due-date sort would bury the work that is due.
 */
export function sortForView<T extends SortableTask>(
  cards: readonly T[],
  view: Pick<KanbanViewConfig, 'sort_by' | 'sort_order'>,
): T[] {
  const direction = view.sort_order === 'desc' ? -1 : 1

  return [...cards].sort((a, b) => {
    // Urgency outranks the chosen sort.
    //
    // A board sorted by due date still has to surface the critical item at the
    // top of its column — otherwise the one card that needs attention today
    // hides three screens down behind a fortnight of ordinary work. The view's
    // own sort then orders everything within a priority band, which is what
    // people actually mean when they pick a sort.
    //
    // Applied regardless of `sort_order`: "most urgent first" is not a
    // direction the reader chose, so descending must not invert it.
    const urgency = priorityRank(a.priority) - priorityRank(b.priority)
    if (urgency !== 0 && view.sort_by !== 'priority') return urgency

    switch (view.sort_by) {
      case 'priority':
        // The one case where the reader explicitly asked for a direction.
        return (priorityRank(a.priority) - priorityRank(b.priority)) * direction
      case 'due_date':
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date) * direction
      case 'title':
        return a.title.localeCompare(b.title) * direction
      case 'created_at':
        // task_number is assigned in creation order per project, so it is a
        // stable proxy that needs no extra column on the card payload.
        return (a.task_number - b.task_number) * direction
      default:
        return (a.position - b.position) * direction
    }
  })
}
