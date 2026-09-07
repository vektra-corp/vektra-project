import { can } from '@pm/auth/rbac'
import type { Priority, TaskStatus } from '@pm/shared/constants'
import { publicIdToString, todayIn } from '@pm/shared/utils'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ProjectViewBar } from '@/components/projects/project-tabs'
import type { ListTask } from '@/components/tasks/task-list-grid'
import { TaskListView } from '@/components/tasks/task-list-view'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'List' }

/** One embed can come back as an object or a one-element array; normalise it. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/**
 * The project's tasks as an editable table (§19.7).
 *
 * Every column the design makes editable is editable here — status, priority,
 * assignee and due date write straight from the row — and each group carries an
 * add row. Subtasks come down with their parents so expanding a row costs no
 * round trip.
 */
export default async function ListPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)

  const project = await resolveProject(params.projectId)
  if (!project) notFound()

  const supabase = createClient()

  const [{ data: tasks }, { data: members }, { data: columns }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `id, public_id, title, status, priority, due_date, task_number,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url),
         assigner:profiles!tasks_assigner_id_fkey(id, full_name),
         subtasks(id, title, status, priority, due_date, position,
                  assignee:profiles!subtasks_assignee_id_fkey(id, full_name))`,
      )
      .eq('project_id', project.id)
      .order('status')
      .order('position'),
    supabase
      .from('project_members')
      .select('user_id, profile:profiles!project_members_user_id_fkey(id, full_name)')
      .eq('project_id', project.id),
    supabase
      .from('kanban_columns')
      .select('id, status, position, board:kanban_boards!kanban_columns_board_id_fkey(project_id)')
      .eq('board.project_id', project.id)
      .order('position'),
  ])

  const today = todayIn(auth.orgTimezone)
  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`

  const rows: ListTask[] = (tasks ?? []).map((task) => ({
    id: task.id,
    publicId: publicIdToString(task.public_id),
    title: task.title,
    taskNumber: task.task_number,
    status: task.status as TaskStatus,
    priority: task.priority as Priority,
    due_date: task.due_date,
    assignee: one(task.assignee),
    assigner: one(task.assigner),
    subtasks: [...(task.subtasks ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        status: subtask.status as TaskStatus,
        priority: subtask.priority as Priority,
        due_date: subtask.due_date,
        assignee: one(subtask.assignee),
      })),
  }))

  // Everyone on the project, plus anyone already assigned — a task assigned
  // before someone left the project must still show their name in the picker.
  const people = new Map<string, { id: string; full_name: string }>()
  for (const member of members ?? []) {
    const profile = one(member.profile)
    if (profile) people.set(profile.id, { id: profile.id, full_name: profile.full_name })
  }
  for (const row of rows) {
    if (row.assignee) people.set(row.assignee.id, row.assignee)
    if (row.assigner) people.set(row.assigner.id, row.assigner)
  }

  // The first column carrying each status is where an add-row task lands.
  const statusColumns: Record<string, string> = {}
  for (const column of columns ?? []) {
    if (column.status && !statusColumns[column.status]) statusColumns[column.status] = column.id
  }

  return (
    <>
      <ProjectViewBar base={base} />

      <TaskListView
        scope={params}
        projectKey={project.key}
        tasks={rows}
        people={[...people.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))}
        statusColumns={statusColumns}
        today={today}
        base={base}
        canEdit={can(auth, 'tasks', 'update')}
        canDelete={can(auth, 'tasks', 'delete')}
      />
    </>
  )
}
