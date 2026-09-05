import { projectKey, todayIn } from '@pm/shared/utils'
import { DataTable, type DataTableColumn, Badge } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { DueDate, TaskPriorityIcon, TaskStatusBadge } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'My tasks' }

interface Row {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  task_number: number
  projectId: string
  projectName: string
  workspaceSlug: string | null
}

/** Everything assigned to the signed-in person, across every project they can see. */
export default async function MyTasksPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()
  const today = todayIn(auth.orgTimezone)

  const { data: tasks } = await supabase
    .from('tasks')
    .select(
      `id, title, status, priority, due_date, task_number, project_id,
       project:projects!tasks_project_id_fkey(
         id, name, workspace:workspaces!projects_workspace_id_fkey(slug)
       )`,
    )
    .eq('assignee_id', auth.userId)
    .not('status', 'in', '(done,cancelled)')
    // Undated work sorts last: a task with a deadline is the more urgent read.
    .order('due_date', { nullsFirst: false })
    .order('priority')
    .limit(200)

  const rows: Row[] = (tasks ?? []).map((task) => {
    const project = Array.isArray(task.project) ? task.project[0] : task.project
    const workspace = project
      ? Array.isArray(project.workspace)
        ? project.workspace[0]
        : project.workspace
      : null

    return {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date,
      task_number: task.task_number,
      projectId: task.project_id,
      projectName: project?.name ?? 'Unknown project',
      workspaceSlug: workspace?.slug ?? null,
    }
  })

  const overdue = rows.filter((row) => row.due_date && row.due_date < today).length

  const hrefFor = (row: Row) =>
    row.workspaceSlug
      ? `/${params.orgSlug}/${row.workspaceSlug}/projects/${row.projectId}/tasks/${row.id}`
      : null

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'id',
      header: 'ID',
      headClassName: 'w-24',
      cell: (row) => (
        <span className="label-id text-faint">
          {projectKey(row.projectName)}-{row.task_number}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Task',
      cell: (row) => {
        const href = hrefFor(row)
        return href ? (
          <Link href={href} className="text-base transition-colors hover:text-primary">
            {row.title}
          </Link>
        ) : (
          <span className="text-base">{row.title}</span>
        )
      },
    },
    {
      key: 'project',
      header: 'Project',
      headClassName: 'w-44',
      cell: (row) => (
        <span className="truncate text-base text-muted-foreground">{row.projectName}</span>
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
      key: 'due',
      header: 'Due',
      headClassName: 'w-24',
      cell: (row) => <DueDate dueDate={row.due_date} today={today} isClosed={false} />,
    },
  ]

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'My tasks' }]}
        meta={
          overdue > 0 ? (
            <Badge variant="destructive" shape="meta" className="ms-1">
              {overdue} overdue
            </Badge>
          ) : null
        }
      />
      <PageBody className="pt-2">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          empty="Nothing is assigned to you right now."
        />
      </PageBody>
    </>
  )
}
