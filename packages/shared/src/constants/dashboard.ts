/** Dashboard widget catalogue and layout rules (claude.md §19.10). */

export const DASHBOARD_WIDGETS = [
  'my_open_tasks',
  'tasks_due_soon',
  'overdue_tasks',
  'active_projects',
  'project_progress',
  'recent_activity',
  'team_workload',
  'my_leave',
  'pending_approvals',
] as const

export type DashboardWidgetType = (typeof DASHBOARD_WIDGETS)[number]

export interface WidgetSpec {
  label: string
  description: string
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
    w: 6,
    h: 5,
    minW: 3,
    minH: 3,
  },
  tasks_due_soon: {
    label: 'Due this week',
    description: 'Your tasks due in the next seven days.',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
  },
  overdue_tasks: {
    label: 'Overdue',
    description: 'Your tasks past their due date.',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
  },
  active_projects: {
    label: 'Active projects',
    description: 'Count of projects currently in flight.',
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
  },
  project_progress: {
    label: 'Project progress',
    description: 'Completion per active project.',
    w: 6,
    h: 5,
    minW: 3,
    minH: 3,
  },
  recent_activity: {
    label: 'Recent activity',
    description: 'What changed most recently across the organization.',
    w: 12,
    h: 4,
    minW: 4,
    minH: 3,
  },
  team_workload: {
    label: 'Team workload',
    description: 'Open tasks per person.',
    w: 6,
    h: 5,
    minW: 3,
    minH: 3,
    managerOnly: true,
  },
  my_leave: {
    label: 'My leave',
    description: 'Your remaining balance per leave type.',
    w: 6,
    h: 4,
    minW: 3,
    minH: 3,
  },
  pending_approvals: {
    label: 'Leave approvals',
    description: 'Requests waiting on your decision.',
    w: 6,
    h: 4,
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
  { widget_id: 'w-leave', type: 'my_leave', x: 9, y: 0, w: 3, h: 2 },
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
