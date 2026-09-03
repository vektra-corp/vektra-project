import { can } from '@pm/auth/rbac'
import { todayIn } from '@pm/shared/utils'
import { Card, CardContent } from '@pm/ui'
import type { Metadata } from 'next'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import type { KanbanCardData } from '@/components/kanban/types'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Board' }

interface EmbeddedLabel {
  label: { id: string; name: string; color: string } | null
}

export default async function BoardPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const { data: board } = await supabase
    .from('kanban_boards')
    .select('id')
    .eq('project_id', params.projectId)
    .eq('is_default', true)
    .maybeSingle()

  if (!board) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          This project has no board yet.
        </CardContent>
      </Card>
    )
  }

  // Four queries rather than one deep join: the counts are grouped client-side,
  // which avoids a correlated subquery per card.
  const [{ data: columns }, { data: tasks }, { data: org }] = await Promise.all([
    supabase
      .from('kanban_columns')
      .select('id, name, color, position, wip_limit, is_done_column, status')
      .eq('board_id', board.id)
      .order('position'),
    supabase
      .from('tasks')
      .select(
        `id, title, status, priority, due_date, position, task_number, kanban_column_id,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url),
         task_labels(label:labels(id, name, color))`,
      )
      .eq('project_id', params.projectId)
      .order('position'),
    supabase.from('organizations').select('timezone').eq('id', auth.orgId).maybeSingle(),
  ])

  const taskIds = (tasks ?? []).map((task) => task.id)

  const [{ data: subtasks }, { data: comments }] = await Promise.all([
    taskIds.length
      ? supabase.from('subtasks').select('task_id, status').in('task_id', taskIds)
      : Promise.resolve({ data: [] as { task_id: string; status: string }[] }),
    taskIds.length
      ? supabase.from('comments').select('task_id').in('task_id', taskIds)
      : Promise.resolve({ data: [] as { task_id: string | null }[] }),
  ])

  const subtaskStats = new Map<string, { total: number; done: number }>()
  for (const subtask of subtasks ?? []) {
    const entry = subtaskStats.get(subtask.task_id) ?? { total: 0, done: 0 }
    entry.total += 1
    if (subtask.status === 'done' || subtask.status === 'cancelled') entry.done += 1
    subtaskStats.set(subtask.task_id, entry)
  }

  const commentCounts = new Map<string, number>()
  for (const comment of comments ?? []) {
    if (!comment.task_id) continue
    commentCounts.set(comment.task_id, (commentCounts.get(comment.task_id) ?? 0) + 1)
  }

  const cards: KanbanCardData[] = (tasks ?? []).map((task) => {
    const stats = subtaskStats.get(task.id) ?? { total: 0, done: 0 }
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee

    return {
      id: task.id,
      title: task.title,
      status: task.status as KanbanCardData['status'],
      priority: task.priority as KanbanCardData['priority'],
      due_date: task.due_date,
      position: task.position,
      task_number: task.task_number,
      kanban_column_id: task.kanban_column_id,
      assignee: assignee ?? null,
      labels: ((task.task_labels ?? []) as EmbeddedLabel[])
        .map((row) => (Array.isArray(row.label) ? row.label[0] : row.label))
        .filter((label): label is { id: string; name: string; color: string } => Boolean(label)),
      subtask_total: stats.total,
      subtask_done: stats.done,
      comment_count: commentCounts.get(task.id) ?? 0,
    }
  })

  return (
    <KanbanBoard
      columns={(columns ?? []) as never}
      cards={cards}
      scope={params}
      // "Overdue" is decided in the org's timezone, not the server's (§21.6).
      today={todayIn(org?.timezone ?? 'UTC')}
      canCreate={can(auth, 'tasks', 'create')}
    />
  )
}
