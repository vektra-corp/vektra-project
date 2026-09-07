import {
  DEFAULT_TASK_REPORT_COLUMNS,
  PRIORITIES,
  TASK_REPORT_COLUMNS,
  TASK_STATUSES,
  normalizeReportColumns,
  type TaskReportColumn,
} from '@pm/shared/constants'
import { formatRelativeTime, initials, publicIdToString, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Badge, Card, CardContent } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import { PageBody, SectionHeader } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { ReportFilters } from '@/components/reports/report-filters'
import { DueDate, TaskPriorityIcon, TaskStatusBadge } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

interface Member {
  id: string
  full_name: string
  avatar_url: string | null
}

export const metadata: Metadata = { title: 'Task report' }

/**
 * Cross-project task report (claude.md §19.7).
 *
 * Columns, filters and sort live in the URL so a filtered view can be shared,
 * bookmarked, and survives a refresh (§10, URL state rule).
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const locale = await getLocale()
  const supabase = createClient()

  const asArray = (value: string | string[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : value.split(',').filter(Boolean)

  const columns = normalizeReportColumns(
    asArray(searchParams.columns).length
      ? asArray(searchParams.columns)
      : DEFAULT_TASK_REPORT_COLUMNS,
  )
  const statusFilter = asArray(searchParams.status)
  const priorityFilter = asArray(searchParams.priority)
  const assigneeFilter = asArray(searchParams.assignee)
  const sortBy = typeof searchParams.sort === 'string' ? searchParams.sort : 'updated_at'
  const sortAsc = searchParams.dir === 'asc'

  let query = supabase
    .from('tasks')
    .select(
      `id, title, status, priority, due_date, created_at, updated_at, started_at, completed_at,
       public_id, estimated_hours, task_number, project_id,
       assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url),
       assigner:profiles!tasks_assigner_id_fkey(id, full_name, avatar_url),
       project:projects(id, public_id, name, workspace:workspaces!projects_workspace_id_fkey(slug)),
       task_labels(label:labels(id, name, color))`,
    )
    .eq('organization_id', auth.orgId)

  if (statusFilter.length) query = query.in('status', statusFilter)
  if (priorityFilter.length) query = query.in('priority', priorityFilter)
  if (assigneeFilter.length) query = query.in('assignee_id', assigneeFilter)

  const sortColumn = TASK_REPORT_COLUMNS[sortBy as TaskReportColumn]?.field
  const orderBy = sortColumn && sortColumn !== '_computed' ? sortColumn : 'updated_at'

  // Capped rather than unbounded: an org with 100k tasks must not be able to
  // ask for all of them in one request (§23.1 rule 3).
  const { data: tasks } = await query.order(orderBy, { ascending: sortAsc }).limit(100)

  const { data: members } = await supabase
    .from('org_members')
    .select('profile:profiles!inner(id, full_name, avatar_url)')
    .eq('organization_id', auth.orgId)

  const one = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value

  const today = todayIn(auth.orgTimezone)

  const assignableMembers = (members ?? [])
    .flatMap((row) => {
      const profile = one(row.profile) as Member | null
      return profile ? [profile] : []
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  function cell(task: Record<string, unknown>, column: TaskReportColumn) {
    switch (column) {
      case 'task_name':
        return <span className="font-medium">{String(task.title)}</span>
      case 'status':
        return <TaskStatusBadge status={task.status as never} />
      case 'priority':
        return <TaskPriorityIcon priority={task.priority as never} showLabel />
      case 'assignee':
      case 'assigned_by': {
        const person = one(
          (column === 'assignee' ? task.assignee : task.assigner) as {
            id: string
            full_name: string
          } | null,
        )
        if (!person) return <span className="text-muted-foreground">—</span>
        return (
          <span className="inline-flex items-center gap-2">
            <Avatar className="h-5 w-5">
              <AvatarFallback className="text-[9px]">{initials(person.full_name)}</AvatarFallback>
            </Avatar>
            {person.full_name}
          </span>
        )
      }
      case 'due_date':
        return task.due_date ? (
          <DueDate
            dueDate={String(task.due_date)}
            today={today}
            isClosed={task.status === 'done' || task.status === 'cancelled'}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      case 'project': {
        const project = one(task.project as { id: string; name: string } | null)
        return project ? project.name : <span className="text-muted-foreground">—</span>
      }
      case 'labels': {
        const labels = (
          (task.task_labels ?? []) as {
            label: { id: string; name: string; color: string } | null
          }[]
        )
          .map((row) => one(row.label))
          .filter(Boolean)
        if (labels.length === 0) return <span className="text-muted-foreground">—</span>
        return (
          <span className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <Badge key={label!.id} variant="outline" className="text-[10px]">
                {label!.name}
              </Badge>
            ))}
          </span>
        )
      }
      case 'created_at':
      case 'updated_at':
      case 'started_at':
      case 'completed_at': {
        const value = task[column]
        return value ? (
          <span className="tabular-nums">{formatRelativeTime(String(value), locale)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      }
      case 'estimated':
        return task.estimated_hours ? (
          <span className="tabular-nums">{String(task.estimated_hours)}h</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      default:
        return <span className="text-muted-foreground">—</span>
    }
  }

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Task report' }]} />
      <SectionHeader
        title="Task report"
        count={`${tasks?.length ?? 0} tasks${(tasks?.length ?? 0) === 100 ? ' (first 100)' : ''}`}
      />

      <PageBody>
        <div className="space-y-4">

          <ReportFilters
            statuses={TASK_STATUSES}
            priorities={PRIORITIES}
            members={assignableMembers}
            selectedColumns={columns}
          />

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-ui">
                  <caption className="sr-only">Tasks across all projects</caption>
                  <thead className="text-muted-foreground border-b text-left text-nav uppercase tracking-wide">
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="whitespace-nowrap px-4 py-3 font-medium"
                        >
                          {TASK_REPORT_COLUMNS[column].label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(tasks ?? []).map((task) => {
                      // The link used to be `?task=<uuid>`, a parameter nothing
                      // on this page reads — clicking a row reloaded the report.
                      // It now opens the task, which is what it looked like it
                      // would do all along.
                      const project = one(task.project) as {
                        public_id: number
                        workspace: { slug: string } | { slug: string }[] | null
                      } | null
                      const workspace = project ? one(project.workspace) : null
                      const href = workspace
                        ? `/${params.orgSlug}/${workspace.slug}/projects/${publicIdToString(project!.public_id)}/tasks/${publicIdToString(task.public_id)}`
                        : null

                      return (
                        <tr key={task.id} className="hover:bg-muted/40 border-b last:border-0">
                          {columns.map((column) => (
                            <td key={column} className="px-4 py-3 align-middle">
                              {column === 'task_name' ? (
                                href ? (
                                  <Link href={href} className="font-medium hover:underline">
                                    {task.title}
                                  </Link>
                                ) : (
                                  <span className="font-medium">{task.title}</span>
                                )
                              ) : (
                                cell(task as never, column)
                              )}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                    {!tasks?.length ? (
                      <tr>
                        <td
                          colSpan={columns.length}
                          className="text-muted-foreground px-4 py-10 text-center"
                        >
                          No tasks match these filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  )
}
