import { initials, projectKey, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, DataTable, type DataTableColumn } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageBody } from '@/components/layout/page-body'
import { ProjectViewTabs } from '@/components/projects/project-tabs'
import { DueDate, TaskPriorityIcon, TaskStatusBadge } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'List' }

interface Row {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  task_number: number
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
}

/** Flat table view of a project's tasks — the same data as the board, sorted. */
export default async function ListPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: tasks }, { data: project }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `id, title, status, priority, due_date, task_number, updated_at,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
      )
      .eq('project_id', params.projectId)
      .order('status')
      .order('position'),
    supabase.from('projects').select('name').eq('id', params.projectId).maybeSingle(),
  ])

  const today = todayIn(auth.orgTimezone)
  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`
  const prefix = projectKey(project?.name ?? 'Task')

  const rows: Row[] = (tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    task_number: task.task_number,
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    assignee: (Array.isArray(task.assignee) ? task.assignee[0] : task.assignee) ?? null,
  }))

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'id',
      header: 'ID',
      headClassName: 'w-24',
      cell: (row) => (
        <span className="label-meta text-faint">
          {prefix}-{row.task_number}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Task',
      cell: (row) => (
        <Link
          href={`${base}/tasks/${row.id}`}
          className="text-foreground hover:text-primary text-base transition-colors"
        >
          {row.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      headClassName: 'w-32',
      cell: (row) => <TaskStatusBadge status={row.status as never} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      headClassName: 'w-24',
      cell: (row) => <TaskPriorityIcon priority={row.priority as never} showLabel />,
    },
    {
      key: 'assignee',
      header: 'Assignee',
      headClassName: 'w-40',
      cell: (row) =>
        row.assignee ? (
          <span className="flex items-center gap-2">
            <Avatar className="h-5 w-5">
              {row.assignee.avatar_url ? (
                <AvatarImage src={row.assignee.avatar_url} alt="" />
              ) : null}
              <AvatarFallback className="bg-surface-hover text-muted-foreground text-[9px] font-medium uppercase">
                {initials(row.assignee.full_name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-muted-foreground truncate text-base">
              {row.assignee.full_name}
            </span>
          </span>
        ) : (
          <span className="label-meta text-faint">Unassigned</span>
        ),
    },
    {
      key: 'due',
      header: 'Due',
      headClassName: 'w-24',
      cell: (row) => (
        <DueDate
          dueDate={row.due_date}
          today={today}
          isClosed={row.status === 'done' || row.status === 'cancelled'}
        />
      ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <ProjectViewTabs base={base} />
        <p className="label-meta text-faint ms-auto">{rows.length} tasks</p>
      </div>

      <PageBody>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty="No tasks in this project yet."
        />
      </PageBody>
    </>
  )
}
