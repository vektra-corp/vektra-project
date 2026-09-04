import { PRIORITIES, type KanbanViewConfig } from '@pm/shared/constants'
import { Progress, SegmentedGroup } from '@pm/ui'
import type { KanbanScope } from '@/components/kanban/types'
import { ProjectViewTabs } from '@/components/projects/project-tabs'
import { CustomizeDialog } from './customize-dialog'
import { FilterChip, type FilterOption } from './filter-chip'
import { SavedViewMenu, type SavedView } from './saved-view-menu'

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'hsl(var(--priority-critical))',
  high: 'hsl(var(--priority-high))',
  medium: 'hsl(var(--priority-medium))',
  low: 'hsl(var(--priority-low))',
}

/**
 * The board's control strip: view switcher, saved view, filters, and progress.
 *
 * A server component so the filter option lists come straight from the data the
 * page already loaded; only the individual controls hydrate.
 */
export function BoardToolbar({
  scope,
  base,
  boardId,
  view,
  views,
  canShare,
  columns,
  assignees,
  labels,
  donePoints,
  totalPoints,
}: {
  scope: KanbanScope
  base: string
  boardId: string
  view: KanbanViewConfig
  views: SavedView[]
  canShare: boolean
  columns: { id: string; name: string; status: string }[]
  assignees: { id: string; full_name: string }[]
  labels: { id: string; name: string; color: string }[]
  donePoints: number
  totalPoints: number
}) {
  const statusOptions: FilterOption[] = columns.map((column) => ({
    value: column.status,
    label: column.name,
  }))

  const assigneeOptions: FilterOption[] = assignees.map((person) => ({
    value: person.id,
    label: person.full_name,
  }))

  const priorityOptions: FilterOption[] = PRIORITIES.map((priority) => ({
    value: priority,
    label: priority === 'critical' ? 'Urgent' : priority[0]!.toUpperCase() + priority.slice(1),
    color: PRIORITY_COLORS[priority],
  }))

  const labelOptions: FilterOption[] = labels.map((label) => ({
    value: label.id,
    label: label.name,
    color: label.color,
  }))

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <ProjectViewTabs base={base} />

      <SavedViewMenu
        scope={scope}
        views={views}
        activeId={view.id}
        activeName={view.name}
        activeIsShared={view.is_shared}
      />

      <SegmentedGroup className="border-transparent bg-transparent p-0">
        <FilterChip param="status" label="Status" options={statusOptions} />
        <FilterChip param="assignee" label="Assignee" options={assigneeOptions} />
        <FilterChip param="priority" label="Priority" options={priorityOptions} />
        <FilterChip param="label" label="Label" options={labelOptions} />
      </SegmentedGroup>

      <div className="ms-auto flex items-center gap-3">
        <div className="hidden items-center gap-2.5 sm:flex">
          <p className="label-meta whitespace-nowrap text-faint">
            <span className="text-foreground">{donePoints}</span>
            <span className="px-1">/</span>
            {totalPoints} pts
          </p>
          <Progress
            value={donePoints}
            max={totalPoints || 1}
            className="w-20"
            aria-label="Points completed"
          />
        </div>

        <CustomizeDialog scope={scope} boardId={boardId} view={view} canShare={canShare} />
      </div>
    </div>
  )
}
