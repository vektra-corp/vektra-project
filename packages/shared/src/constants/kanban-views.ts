/** Customizable Kanban view configuration (claude.md §19.8). */

export const KANBAN_GROUP_BY = [
  'status',
  'assignee',
  'priority',
  'label',
  'custom_field',
  'due_date_range',
] as const
export type KanbanGroupBy = (typeof KANBAN_GROUP_BY)[number]

export const KANBAN_GROUP_BY_LABELS: Record<KanbanGroupBy, string> = {
  status: 'Status',
  assignee: 'Assignee',
  priority: 'Priority',
  label: 'Label',
  custom_field: 'Custom field',
  due_date_range: 'Due date',
}

/** Fields a card can display. Order here is the order they render. */
export const KANBAN_CARD_FIELDS = [
  'assignee',
  'priority',
  'due_date',
  'labels',
  'subtask_progress',
  'estimated_hours',
  'time_logged',
  'task_number',
] as const
export type KanbanCardField = (typeof KANBAN_CARD_FIELDS)[number]

export const KANBAN_CARD_FIELD_LABELS: Record<KanbanCardField, string> = {
  assignee: 'Assignee',
  priority: 'Priority',
  due_date: 'Due date',
  labels: 'Labels',
  subtask_progress: 'Subtask progress',
  estimated_hours: 'Estimated hours',
  time_logged: 'Time logged',
  task_number: 'Task number',
}

export const KANBAN_COLOR_BY = ['priority', 'label', 'status', 'custom_field', 'none'] as const
export type KanbanColorBy = (typeof KANBAN_COLOR_BY)[number]

export const KANBAN_SWIMLANE_BY = ['none', 'assignee', 'priority', 'label', 'custom_field'] as const
export type KanbanSwimlaneBy = (typeof KANBAN_SWIMLANE_BY)[number]

export const KANBAN_SORT_BY = ['position', 'priority', 'due_date', 'created_at', 'title'] as const
export type KanbanSortBy = (typeof KANBAN_SORT_BY)[number]

export const DEFAULT_CARD_FIELDS: KanbanCardField[] = [
  'assignee',
  'priority',
  'due_date',
  'labels',
  'subtask_progress',
]

export interface KanbanViewConfig {
  id: string
  name: string
  is_default: boolean
  is_shared: boolean
  group_by: KanbanGroupBy
  group_field_id: string | null
  card_fields: KanbanCardField[]
  card_color_by: KanbanColorBy
  card_color_map: Record<string, string> | null
  swimlane_by: KanbanSwimlaneBy
  sort_by: KanbanSortBy
  sort_order: 'asc' | 'desc'
  filters: Record<string, unknown>
  show_empty_columns: boolean
  show_column_count: boolean
  compact_mode: boolean
}

/** Applied when a board has no saved view. */
export const DEFAULT_KANBAN_VIEW: Omit<KanbanViewConfig, 'id'> = {
  name: 'Default view',
  is_default: true,
  is_shared: false,
  group_by: 'status',
  group_field_id: null,
  card_fields: DEFAULT_CARD_FIELDS,
  card_color_by: 'priority',
  card_color_map: null,
  swimlane_by: 'none',
  sort_by: 'position',
  sort_order: 'asc',
  filters: {},
  show_empty_columns: true,
  show_column_count: true,
  compact_mode: false,
}

export function isCardFieldVisible(
  view: Pick<KanbanViewConfig, 'card_fields'>,
  field: KanbanCardField,
): boolean {
  return view.card_fields.includes(field)
}

/**
 * Only `status` grouping maps onto real kanban_columns rows, so it is the only
 * mode where a drag can persist a column id. Every other mode derives its
 * columns at read time, and dropping a card updates the grouped attribute
 * instead (reassigning it, changing its priority, and so on).
 */
export function groupingUsesRealColumns(groupBy: KanbanGroupBy): boolean {
  return groupBy === 'status'
}
