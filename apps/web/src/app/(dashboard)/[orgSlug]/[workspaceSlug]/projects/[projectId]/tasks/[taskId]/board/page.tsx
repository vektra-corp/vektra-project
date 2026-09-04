import { can } from '@pm/auth/rbac'
import { PLAN_LIMITS, type PlanName } from '@pm/shared/constants'
import { todayIn } from '@pm/shared/utils'
import { Button } from '@pm/ui'
import { ArrowLeft, Lock } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageBody } from '@/components/layout/page-body'
import {
  SubtaskBoard,
  type SubtaskCardData,
  type SubtaskColumnData,
} from '@/components/subtasks/subtask-board'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Subtasks' }

/**
 * Subtask-level Kanban (§4, §20 Phase 2).
 *
 * The board is provisioned on first visit by `ensure_task_board` (00028) rather
 * than by a trigger on every task — most tasks never have subtasks, and a
 * board plus four columns each would be a lot of rows for nothing. That
 * function also adopts subtasks that already existed as checklist items, so
 * this page never shows an empty board beside a populated list.
 */
export default async function SubtaskBoardPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string; taskId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const taskHref = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}/tasks/${params.taskId}`

  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, task_number')
    .eq('id', params.taskId)
    .eq('organization_id', auth.orgId)
    .maybeSingle()

  if (!task) notFound()

  // A paid feature (§17). Gated here rather than rendering an empty board, so
  // the reason is legible instead of looking broken — and gated before
  // provisioning, so a Starter org never accumulates board rows it cannot use.
  const plan = (auth.planName ?? 'starter') as PlanName
  if (!PLAN_LIMITS[plan]?.subtask_kanban) {
    return (
      <PageBody className="pt-4">
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
          <Lock className="h-6 w-6 text-faint" aria-hidden />
          <p className="pt-3 text-[13px] font-medium">Subtask boards are not on your plan</p>
          <p className="pt-1 max-w-sm text-[13px] text-muted-foreground">
            Running subtasks on their own Kanban is included from Growth upward. The
            checklist on the task itself is always available.
          </p>
          <div className="flex gap-2 pt-4">
            <Button asChild size="sm" variant="outline">
              <Link href={taskHref}>Back to the task</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/${params.orgSlug}/settings/billing`}>See plans</Link>
            </Button>
          </div>
        </div>
      </PageBody>
    )
  }

  // Idempotent: returns the existing board, or creates one and adopts the
  // task's existing subtasks into the columns their status implies.
  const { data: boardId, error: boardError } = await supabase.rpc('ensure_task_board', {
    p_task_id: params.taskId,
  })

  if (boardError || !boardId) notFound()

  const [{ data: columns }, { data: subtasks }] = await Promise.all([
    supabase
      .from('kanban_columns')
      .select('id, name, color, position, wip_limit, status')
      .eq('board_id', boardId)
      .order('position'),
    supabase
      .from('subtasks')
      .select(
        `id, title, status, priority, due_date, position, kanban_column_id, estimated_hours,
         assignee:profiles!subtasks_assignee_id_fkey(id, full_name, avatar_url)`,
      )
      .eq('task_id', params.taskId)
      .order('position'),
  ])

  // PostgREST returns a to-one embed as an object while the generated types
  // allow an array — normalise rather than cast.
  const one = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value

  const cards: SubtaskCardData[] = (subtasks ?? []).map((subtask) => ({
    id: subtask.id,
    title: subtask.title,
    status: subtask.status,
    priority: subtask.priority,
    due_date: subtask.due_date,
    position: subtask.position,
    kanban_column_id: subtask.kanban_column_id,
    estimated_hours: subtask.estimated_hours,
    assignee: one(subtask.assignee),
  }))

  return (
    <PageBody className="pt-4">
      <div className="space-y-4 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={taskHref}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Task
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">{task.title}</h1>
            <p className="pt-0.5 text-[13px] text-muted-foreground">
              {cards.length} subtask{cards.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <SubtaskBoard
          scope={params}
          taskId={params.taskId}
          columns={(columns ?? []) as SubtaskColumnData[]}
          subtasks={cards}
          today={todayIn(auth.orgTimezone)}
          canEdit={can(auth, 'tasks', 'update')}
        />
      </div>
    </PageBody>
  )
}
