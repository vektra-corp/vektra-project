import { can } from '@pm/auth/rbac'
import { deriveColumns, listViews, loadView, sortForView } from '@pm/db'
import type { KanbanViewConfig } from '@pm/shared/constants'
import { publicIdToString, todayIn } from '@pm/shared/utils'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BoardToolbar } from '@/components/board/board-toolbar'
import { CaptureBar } from '@/components/board/capture-bar'
import { BoardFilterBar } from '@/components/board/filter-bar'
import { KanbanBoard } from '@/components/kanban/kanban-board'
import type { KanbanCardData, KanbanColumnData } from '@/components/kanban/types'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Board' }

interface EmbeddedLabel {
  label: { id: string; name: string; color: string } | null
}

/** Search params arrive as a string or a string[] depending on repetition. */
function asList(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  const auth = await requireAuthPage(params.orgSlug)

  // The URL carries the project's 16-digit public id; everything below here
  // needs the uuid the foreign keys are written against.
  const project = await resolveProject(params.projectId)
  if (!project) notFound()

  const supabase = createClient()

  const { data: board } = await supabase
    .from('kanban_boards')
    .select('id')
    .eq('project_id', project.id)
    .eq('is_default', true)
    .maybeSingle()

  if (!board) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-10 text-ui">
        This project has no board yet.
      </div>
    )
  }

  // Separate queries rather than one deep join: the counts are grouped in
  // memory, which avoids a correlated subquery per card.
  const [{ data: columns }, { data: tasks }, { data: labels }] =
    await Promise.all([
      supabase
        .from('kanban_columns')
        .select('id, name, color, position, wip_limit, is_done_column, status')
        .eq('board_id', board.id)
        .order('position'),
      supabase
        .from('tasks')
        .select(
          `id, public_id, title, status, priority, due_date, position, task_number, kanban_column_id, estimated_hours,
           assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url),
           task_labels(label:labels(id, name, color))`,
        )
        .eq('project_id', project.id)
        .order('position'),
      supabase
        .from('labels')
        .select('id, name, color')
        .eq('organization_id', auth.orgId)
        .order('name'),
    ])

  const taskIds = (tasks ?? []).map((task) => task.id)

  const [{ data: subtasks }, { data: comments }, { data: dependencies }] = await Promise.all([
    taskIds.length
      ? supabase.from('subtasks').select('task_id, status').in('task_id', taskIds)
      : Promise.resolve({ data: [] as { task_id: string; status: string }[] }),
    taskIds.length
      ? supabase.from('comments').select('task_id').in('task_id', taskIds)
      : Promise.resolve({ data: [] as { task_id: string | null }[] }),
    // A card is blocked while any predecessor is still open, so the predecessor's
    // status has to come back with the edge.
    taskIds.length
      ? supabase
          .from('task_dependencies')
          .select('successor_id, predecessor:tasks!task_dependencies_predecessor_id_fkey(status)')
          .in('successor_id', taskIds)
      : Promise.resolve({
          data: [] as { successor_id: string; predecessor: { status: string } | null }[],
        }),
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

  const blocked = new Set<string>()
  for (const edge of dependencies ?? []) {
    const predecessor = Array.isArray(edge.predecessor) ? edge.predecessor[0] : edge.predecessor
    if (!predecessor) continue
    if (predecessor.status !== 'done' && predecessor.status !== 'cancelled') {
      blocked.add(edge.successor_id)
    }
  }

  const prefix = project.key

  const allCards: KanbanCardData[] = (tasks ?? []).map((task) => {
    const stats = subtaskStats.get(task.id) ?? { total: 0, done: 0 }
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee

    return {
      id: task.id,
      publicId: publicIdToString(task.public_id),
      title: task.title,
      status: task.status as KanbanCardData['status'],
      priority: task.priority as KanbanCardData['priority'],
      due_date: task.due_date,
      position: task.position,
      task_number: task.task_number,
      task_prefix: prefix,
      kanban_column_id: task.kanban_column_id,
      estimated_hours: task.estimated_hours,
      is_blocked: blocked.has(task.id),
      assignee: assignee ?? null,
      labels: ((task.task_labels ?? []) as EmbeddedLabel[])
        .map((row) => (Array.isArray(row.label) ? row.label[0] : row.label))
        .filter((label): label is { id: string; name: string; color: string } => Boolean(label)),
      subtask_total: stats.total,
      subtask_done: stats.done,
      comment_count: commentCounts.get(task.id) ?? 0,
    }
  })

  // The saved view decides grouping, sorting and which fields cards show
  // (§19.8). `?view=` overrides the viewer's default so a board link opens on
  // the same view the sender was looking at.
  const [savedViews, defaultView] = await Promise.all([
    listViews(supabase, board.id),
    loadView(supabase, board.id, auth.userId),
  ])

  const requestedId = typeof searchParams.view === 'string' ? searchParams.view : null
  // Only ids that appear in the viewer's own list are loaded, so `?view=` cannot
  // be used to probe for the existence of another board's views.
  const isLoadable =
    requestedId !== null &&
    requestedId !== defaultView.id &&
    savedViews.some((row) => row.id === requestedId)

  const view: KanbanViewConfig = isLoadable
    ? await loadViewById(supabase, requestedId, defaultView)
    : defaultView

  // Filters come from the URL so a filtered board can be refreshed and shared
  // (§10). They narrow what is shown, never what the meter counts — the sprint
  // total has to stay stable while you look at a slice of it.
  const statusFilter = asList(searchParams.status)
  const assigneeFilter = asList(searchParams.assignee)
  const priorityFilter = asList(searchParams.priority)
  const labelFilter = asList(searchParams.label)

  const cards = allCards.filter((card) => {
    if (statusFilter.length && !statusFilter.includes(card.status)) return false
    if (assigneeFilter.length && !assigneeFilter.includes(card.assignee?.id ?? '')) return false
    if (priorityFilter.length && !priorityFilter.includes(card.priority)) return false
    if (labelFilter.length && !card.labels.some((label) => labelFilter.includes(label.id))) {
      return false
    }
    return true
  })

  const assignees = Array.from(
    new Map(
      allCards
        .map((card) => card.assignee)
        .filter((person): person is NonNullable<typeof person> => person !== null)
        .map((person) => [person.id, { id: person.id, full_name: person.full_name }]),
    ).values(),
  ).sort((a, b) => a.full_name.localeCompare(b.full_name))

  // The chips the design shows under the toolbar, in the order the filters are
  // offered. Each carries the param it clears, so the strip needs no lookup.
  const priorityNames: Record<string, string> = {
    critical: 'Urgent',
    high: 'High',
    medium: 'Med',
    low: 'Low',
  }
  const activeFilters = [
    ...statusFilter.map((value) => ({
      param: 'status',
      value,
      label: `Status: ${(columns ?? []).find((column) => column.status === value)?.name ?? value}`,
    })),
    ...assigneeFilter.map((value) => ({
      param: 'assignee',
      value,
      label: `Assignee: ${assignees.find((person) => person.id === value)?.full_name.split(' ')[0] ?? 'Unassigned'}`,
    })),
    ...priorityFilter.map((value) => ({
      param: 'priority',
      value,
      label: `Priority: ${priorityNames[value] ?? value}`,
    })),
    ...labelFilter.map((value) => ({
      param: 'label',
      value,
      label: `Label: ${(labels ?? []).find((label) => label.id === value)?.name ?? value}`,
    })),
  ]

  const totalPoints = allCards.reduce((sum, card) => sum + (card.estimated_hours ?? 0), 0)
  const donePoints = allCards
    .filter((card) => card.status === 'done')
    .reduce((sum, card) => sum + (card.estimated_hours ?? 0), 0)

  const sorted = sortForView(cards, view)

  const derived = deriveColumns(view, columns ?? [], sorted).map((column) => ({
    id: column.id,
    name: column.name,
    color: column.color,
    position: column.position,
    wip_limit: column.wip_limit,
    is_done_column: column.is_done_column,
    // Derived columns have no status of their own; the board only reads this
    // under status grouping, where it is the real column's status.
    status: (column.status ?? 'todo') as KanbanColumnData['status'],
    value: column.value,
    // Grouped by assignee, the column head is the person rather than a status
    // dot, so it needs a name to take initials from. `value` is the user id;
    // the display name comes from the assignee list already built above.
    avatarLabel:
      view.group_by === 'assignee'
        ? (assignees.find((person) => person.id === column.value)?.full_name ?? column.name)
        : null,
  })) satisfies KanbanColumnData[]

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`
  const canCreate = can(auth, 'tasks', 'create')

  return (
    <>
      {canCreate ? (
        <CaptureBar
          scope={params}
          columnId={columns?.[0]?.id ?? null}
          assignees={assignees}
          labels={labels ?? []}
        />
      ) : null}

      <BoardToolbar
        scope={params}
        base={base}
        boardId={board.id}
        view={view}
        views={savedViews.map((row) => ({
          id: row.id,
          name: row.name,
          isShared: row.is_shared,
          isMine: row.created_by === auth.userId,
        }))}
        canShare={['owner', 'admin', 'manager'].includes(auth.orgRole)}
        columns={(columns ?? []).map((column) => ({
          id: column.id,
          name: column.name,
          status: column.status,
          wip_limit: column.wip_limit,
        }))}
        assignees={assignees}
        labels={labels ?? []}
        donePoints={donePoints}
        totalPoints={totalPoints}
      />

      <BoardFilterBar
        filters={activeFilters}
        hiddenCount={allCards.length - cards.length}
      />

      <KanbanBoard
        columns={derived}
        cards={sorted}
        scope={params}
        view={view}
        // "Overdue" is decided in the org's timezone, not the server's (§21.6).
        today={todayIn(auth.orgTimezone)}
        canCreate={canCreate}
      />
    </>
  )
}

/**
 * Load one saved view by id.
 *
 * `loadView` resolves the viewer's default; this is the `?view=` case. RLS
 * decides whether the row is visible at all, so a link to someone's private
 * view falls back to the default rather than erroring.
 */
async function loadViewById(
  db: Parameters<typeof loadView>[0],
  viewId: string,
  fallback: KanbanViewConfig,
): Promise<KanbanViewConfig> {
  const { data } = await db.from('kanban_view_configs').select('*').eq('id', viewId).maybeSingle()
  if (!data) return fallback

  return {
    id: data.id,
    name: data.name,
    is_default: data.is_default,
    is_shared: data.is_shared,
    group_by: data.group_by as KanbanViewConfig['group_by'],
    group_field_id: data.group_field_id,
    card_fields: (data.card_fields as KanbanViewConfig['card_fields']) ?? fallback.card_fields,
    card_color_by: data.card_color_by as KanbanViewConfig['card_color_by'],
    card_color_map: data.card_color_map as Record<string, string> | null,
    swimlane_by: data.swimlane_by as KanbanViewConfig['swimlane_by'],
    sort_by: data.sort_by as KanbanViewConfig['sort_by'],
    sort_order: data.sort_order as 'asc' | 'desc',
    filters: (data.filters as Record<string, unknown>) ?? {},
    show_empty_columns: data.show_empty_columns,
    show_column_count: data.show_column_count,
    compact_mode: data.compact_mode,
  }
}
