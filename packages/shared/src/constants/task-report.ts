/**
 * Task report column definitions (claude.md §19.7).
 *
 * This is the authoritative list of columns the report can render. The UI reads
 * it to build the column picker, and the query layer reads `field` and `join`
 * to know what to select — so adding a column here is the only change needed.
 */

export interface TaskReportColumnDef {
  /** Column on `tasks`, or `_computed` when it is derived. */
  field: string
  label: string
  /** Always shown; cannot be removed from the picker. */
  required: boolean
  sortable: boolean
  filterable: boolean
  /** Related table to embed when this column is selected. */
  join?: string
  /** Rendering hint for the table cell. */
  kind: 'text' | 'date' | 'datetime' | 'user' | 'enum' | 'number' | 'labels' | 'progress'
}

export const TASK_REPORT_COLUMNS = {
  // --- Core -------------------------------------------------------------------
  task_name: {
    field: 'title', label: 'Task name', required: true,
    sortable: true, filterable: false, kind: 'text',
  },
  due_date: {
    field: 'due_date', label: 'Due date', required: false,
    sortable: true, filterable: true, kind: 'date',
  },
  assigned_by: {
    field: 'assigner_id', label: 'Assigned by', required: false,
    sortable: true, filterable: true, join: 'profiles', kind: 'user',
  },
  assignee: {
    field: 'assignee_id', label: 'Assignee', required: false,
    sortable: true, filterable: true, join: 'profiles', kind: 'user',
  },
  status: {
    field: 'status', label: 'Status', required: false,
    sortable: true, filterable: true, kind: 'enum',
  },
  priority: {
    field: 'priority', label: 'Priority', required: false,
    sortable: true, filterable: true, kind: 'enum',
  },
  created_at: {
    field: 'created_at', label: 'Created', required: false,
    sortable: true, filterable: true, kind: 'datetime',
  },
  updated_at: {
    field: 'updated_at', label: 'Last updated', required: false,
    sortable: true, filterable: true, kind: 'datetime',
  },
  started_at: {
    field: 'started_at', label: 'Start date time', required: false,
    sortable: true, filterable: true, kind: 'datetime',
  },
  completed_at: {
    field: 'completed_at', label: 'End date time', required: false,
    sortable: true, filterable: true, kind: 'datetime',
  },

  // --- Extended ---------------------------------------------------------------
  project: {
    field: 'project_id', label: 'Project', required: false,
    sortable: true, filterable: true, join: 'projects', kind: 'text',
  },
  labels: {
    field: 'labels', label: 'Labels', required: false,
    sortable: false, filterable: true, kind: 'labels',
  },
  subtask_count: {
    field: '_computed', label: 'Subtasks', required: false,
    sortable: true, filterable: false, kind: 'progress',
  },
  time_logged: {
    field: '_computed', label: 'Time logged', required: false,
    sortable: true, filterable: false, kind: 'number',
  },
  estimated: {
    field: 'estimated_hours', label: 'Estimated', required: false,
    sortable: true, filterable: true, kind: 'number',
  },
} as const satisfies Record<string, TaskReportColumnDef>

export type TaskReportColumn = keyof typeof TASK_REPORT_COLUMNS

export const TASK_REPORT_COLUMN_KEYS = Object.keys(TASK_REPORT_COLUMNS) as TaskReportColumn[]

/** Shown when a user has not saved a column preference. */
export const DEFAULT_TASK_REPORT_COLUMNS: TaskReportColumn[] = [
  'task_name',
  'status',
  'priority',
  'assignee',
  'due_date',
  'updated_at',
]

export const REQUIRED_TASK_REPORT_COLUMNS = TASK_REPORT_COLUMN_KEYS.filter(
  (key) => TASK_REPORT_COLUMNS[key].required,
)

export function isTaskReportColumn(value: string): value is TaskReportColumn {
  return value in TASK_REPORT_COLUMNS
}

/**
 * Normalize a caller-supplied column list: drop unknown keys, force the
 * required ones in, and preserve the user's ordering otherwise.
 */
export function normalizeReportColumns(requested: readonly string[]): TaskReportColumn[] {
  const valid = requested.filter(isTaskReportColumn)
  const missing = REQUIRED_TASK_REPORT_COLUMNS.filter((key) => !valid.includes(key))
  return [...missing, ...valid]
}
