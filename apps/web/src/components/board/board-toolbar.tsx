import type { KanbanViewConfig } from '@pm/shared/constants'
import { Progress } from '@pm/ui'
import type { KanbanScope } from '@/components/kanban/types'
import { ProjectViewTabs } from '@/components/projects/project-tabs'
import { CustomizeDialog } from './customize-dialog'
import { GroupByTabs } from './group-by-tabs'
import { SavedViewMenu, type SavedView } from './saved-view-menu'

/**
 * The board's control strip.
 *
 * The design's order, left to right: the view switcher, a hairline rule, the
 * saved-view chip, the grouping tabs, then — pushed to the end — the sprint
 * points meter and the Customize button. Filters are not here; they live in the
 * Customize panel and surface as the strip of chips beneath this bar, which is
 * where the design puts them.
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
  return (
    <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2.5">
      <ProjectViewTabs base={base} />

      {/* The design rules off the view switcher from the view/grouping controls. */}
      <span className="bg-input hidden h-[18px] w-px sm:block" aria-hidden />

      <SavedViewMenu
        scope={scope}
        views={views}
        activeId={view.id}
        activeName={view.name}
        activeIsShared={view.is_shared}
      />

      <GroupByTabs scope={scope} boardId={boardId} viewId={view.id} active={view.group_by} />

      <div className="ms-auto flex items-center gap-3">
        <div className="hidden items-center gap-3 sm:flex">
          <p className="text-faint whitespace-nowrap font-mono text-col tabular-nums tracking-[0.06em]">
            <span className="text-muted-foreground">{donePoints}</span>
            <span className="px-1">/</span>
            {totalPoints} PTS
          </p>
          <Progress
            value={donePoints}
            max={totalPoints || 1}
            className="h-1 w-[100px] rounded-sm"
            aria-label="Points completed"
          />
        </div>

        <CustomizeDialog
          scope={scope}
          boardId={boardId}
          view={view}
          canShare={canShare}
          columns={columns}
          assignees={assignees}
          labels={labels}
        />
      </div>
    </div>
  )
}
