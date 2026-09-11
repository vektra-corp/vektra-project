/** Dashboard widget catalogue and layout rules (claude.md §19.10). */

export const DASHBOARD_WIDGETS = [
  'my_open_tasks',
  'tasks_due_soon',
  'overdue_tasks',
  'active_projects',
  'project_progress',
  'recent_activity',
  'team_workload',
] as const

export type DashboardWidgetType = (typeof DASHBOARD_WIDGETS)[number]

/**
 * Which part of the product a widget reports on.
 *
 * The design tags every widget with its module in the meta face, and groups the
 * catalogue by the same key, so a mixed dashboard stays legible: you can tell at
 * a glance which panels are delivery, which are money and which are people,
 * without reading the titles.
 */
export const WIDGET_CATEGORIES = ['pm', 'workflow'] as const
export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number]

export const WIDGET_CATEGORY_LABELS: Record<WidgetCategory, string> = {
  pm: 'PM',
  workflow: 'WORKFLOW',
}

export interface WidgetSpec {
  label: string
  description: string
  category: WidgetCategory
  /** Default grid footprint, in columns and rows. */
  w: number
  h: number
  minW: number
  minH: number
  /** Widgets only a manager or above can meaningfully fill. */
  managerOnly?: boolean
}

export const WIDGET_SPECS: Record<DashboardWidgetType, WidgetSpec> = {
  my_open_tasks: {
    label: 'My open tasks',
    description: 'Everything assigned to you that is not done.',
    category: 'pm',
    w: 6,
    h: 5,
    minW: 3,
    minH: 3,
  },
  tasks_due_soon: {
    label: 'Due this week',
    description: 'Your tasks due in the next seven days.',
    category: 'pm',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
  },
  overdue_tasks: {
    label: 'Overdue',
    description: 'Your tasks past their due date.',
    category: 'pm',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
  },
  active_projects: {
    label: 'Active projects',
    description: 'Count of projects currently in flight.',
    category: 'pm',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
  },
  project_progress: {
    label: 'Project progress',
    description: 'Completion per active project.',
    category: 'pm',
    w: 6,
    h: 5,
    minW: 3,
    minH: 3,
  },
  recent_activity: {
    // Named for what it can actually show. There is no actor here: the widget
    // reads `tasks` ordered by updated_at, because the `events` table that
    // records who did what is admin-only by policy and would be empty for the
    // roles this dashboard serves. Calling it "Recent activity" promised a
    // feed of people and delivered a list of rows.
    label: 'Recently updated',
    description: 'Tasks that changed most recently, newest first.',
    category: 'pm',
    w: 12,
    h: 4,
    minW: 4,
    minH: 3,
  },
  team_workload: {
    label: 'Team workload',
    description: 'Open tasks per person.',
    category: 'pm',
    w: 6,
    h: 5,
    minW: 3,
    minH: 3,
    managerOnly: true,
  },
}

export const DASHBOARD_COLUMNS = 12
export const DASHBOARD_ROW_HEIGHT = 44

export interface WidgetPlacement {
  widget_id: string
  type: DashboardWidgetType
  x: number
  y: number
  w: number
  h: number
}

/** Shown to someone who has never customised their dashboard. */
export const DEFAULT_DASHBOARD: WidgetPlacement[] = [
  { widget_id: 'w-due', type: 'tasks_due_soon', x: 0, y: 0, w: 3, h: 2 },
  { widget_id: 'w-overdue', type: 'overdue_tasks', x: 3, y: 0, w: 3, h: 2 },
  { widget_id: 'w-projects', type: 'active_projects', x: 6, y: 0, w: 3, h: 2 },
  { widget_id: 'w-tasks', type: 'my_open_tasks', x: 0, y: 2, w: 6, h: 5 },
  { widget_id: 'w-progress', type: 'project_progress', x: 6, y: 2, w: 6, h: 5 },
  { widget_id: 'w-activity', type: 'recent_activity', x: 0, y: 7, w: 12, h: 4 },
]

export function isDashboardWidget(value: unknown): value is DashboardWidgetType {
  return typeof value === 'string' && (DASHBOARD_WIDGETS as readonly string[]).includes(value)
}

/**
 * Coerce stored jsonb into a usable layout.
 *
 * A saved layout can contain a widget type that no longer exists — a removed
 * feature, or a row written by a newer deploy. Unknown entries are dropped
 * rather than rendered as a blank hole or crashed on.
 */
export function parseLayout(raw: unknown): WidgetPlacement[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    if (!isDashboardWidget(item.type)) return []

    const spec = WIDGET_SPECS[item.type]
    const number = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback

    return [
      {
        widget_id: typeof item.widget_id === 'string' ? item.widget_id : `w-${item.type}`,
        type: item.type,
        x: Math.max(0, Math.min(DASHBOARD_COLUMNS - 1, number(item.x, 0))),
        y: Math.max(0, number(item.y, 0)),
        w: Math.max(spec.minW, Math.min(DASHBOARD_COLUMNS, number(item.w, spec.w))),
        h: Math.max(spec.minH, number(item.h, spec.h)),
      },
    ]
  })
}
