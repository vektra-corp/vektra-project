'use client'

import { KANBAN_GROUP_BY_LABELS, type KanbanGroupBy } from '@pm/shared/constants'
import { SegmentedGroup, SegmentedItem, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { updateKanbanView } from '@/app/(dashboard)/[orgSlug]/[workspaceSlug]/projects/[projectId]/view-actions'
import type { KanbanScope } from '@/components/kanban/types'

/**
 * The board's grouping switcher, which the design puts directly in the toolbar
 * beside the saved-view chip.
 *
 * Only the four groupings that derive real columns are offered here. Custom
 * fields and due-date ranges are configured from the Customize panel, where
 * they can be given the field they need.
 */
const GROUPINGS: KanbanGroupBy[] = ['status', 'assignee', 'priority', 'label']

export function GroupByTabs({
  scope,
  boardId,
  viewId,
  active,
}: {
  scope: KanbanScope
  boardId: string
  /** 'default' when the board has no saved view yet — see `updateKanbanView`. */
  viewId: string
  active: KanbanGroupBy
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function pick(groupBy: KanbanGroupBy) {
    if (groupBy === active) return
    startTransition(async () => {
      const result = await updateKanbanView(scope, boardId, viewId, { group_by: groupBy })
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not regroup', description: result.message })
        return
      }
      router.refresh()
    })
  }

  return (
    <SegmentedGroup aria-label="Group cards by">
      {GROUPINGS.map((groupBy) => (
        <SegmentedItem
          key={groupBy}
          size="sm"
          active={groupBy === active}
          disabled={pending}
          onClick={() => pick(groupBy)}
        >
          {KANBAN_GROUP_BY_LABELS[groupBy]}
        </SegmentedItem>
      ))}
    </SegmentedGroup>
  )
}
