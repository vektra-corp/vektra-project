import { formatRelativeTime, initials, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@pm/ui'
import { addDays, format } from 'date-fns'
import { AlertTriangle, CalendarClock, CircleDot, FolderKanban } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { ProjectProgressList, type ProjectProgressRow } from '@/components/dashboard/project-progress'
import { StatTile } from '@/components/dashboard/stat-tile'
import { Widget, WidgetEmpty } from '@/components/dashboard/widget'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { DueDate, TaskPriorityIcon } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard' }

interface TaskRow {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  project_id: string
  updated_at: string
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
}

/**
 * Personal dashboard.
 *
 * Everything here is scoped to the signed-in person first and the organization
 * second, because "what should I do next" is the question a dashboard opens on.
 * The configurable widget grid (§19.10) builds on these widgets in V1.
 */
export default async function DashboardPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const t = await getTranslations()
  const locale = await getLocale()
  const supabase = createClient()

  // "Today" is the organization's today, not the server's (§21.6).
  const today = todayIn(auth.orgTimezone)
  const weekEnd = format(addDays(new Date(`${today}T00:00:00Z`), 7), 'yyyy-MM-dd')

  const [{ data: myTasks }, { data: projects }, { data: recent }, { count: activeProjects }] =
    await Promise.all([
      supabase
        .from('tasks')
        .select(
          `id, title, status, priority, due_date, project_id, updated_at,
           assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
        )
        .eq('assignee_id', auth.userId)
        .not('status', 'in', '(done,cancelled)')
        .order('due_date', { nullsFirst: false })
        .limit(50),
      supabase
        .from('projects')
        .select('id, name, workspace:workspaces!projects_workspace_id_fkey(slug)')
        .eq('organization_id', auth.orgId)
        .eq('status', 'active')
        .order('name')
        .limit(6),
      // Activity from tasks the viewer can already see; the events table is
      // admin-only by policy, so it would be empty for most roles here.
      supabase
        .from('tasks')
        .select(
          `id, title, status, priority, due_date, project_id, updated_at,
           assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
        )
        .eq('organization_id', auth.orgId)
        .order('updated_at', { ascending: false })
        .limit(8),
      supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', auth.orgId)
        .eq('status', 'active'),
    ])

  const normalise = (rows: typeof myTasks): TaskRow[] =>
    (rows ?? []).map((row) => ({
      ...row,
      // PostgREST returns a to-one embed as an object; the generated types allow
      // an array, so normalise rather than casting blindly.
      assignee: (Array.isArray(row.assignee) ? row.assignee[0] : row.assignee) ?? null,
    }))

  const mine = normalise(myTasks)
  const activity = normalise(recent)

  const overdue = mine.filter((task) => task.due_date && task.due_date < today)
  const dueThisWeek = mine.filter(
    (task) => task.due_date && task.due_date >= today && task.due_date <= weekEnd,
  )

  // Counted in memory: both lists are already loaded, and this avoids a
  // correlated subquery per project.
  const projectIds = (projects ?? []).map((project) => project.id)
  const { data: projectTasks } = projectIds.length
    ? await supabase.from('tasks').select('project_id, status').in('project_id', projectIds)
    : { data: [] as { project_id: string; status: string }[] }

  const stats = new Map<string, { total: number; done: number }>()
  for (const task of projectTasks ?? []) {
    const entry = stats.get(task.project_id) ?? { total: 0, done: 0 }
    entry.total += 1
    if (task.status === 'done') entry.done += 1
    stats.set(task.project_id, entry)
  }

  const progressRows: ProjectProgressRow[] = (projects ?? [])
    .map((project) => {
      const workspace = Array.isArray(project.workspace) ? project.workspace[0] : project.workspace
      if (!workspace) return null
      const stat = stats.get(project.id) ?? { total: 0, done: 0 }
      return {
        id: project.id,
        name: project.name,
        workspaceSlug: workspace.slug,
        done: stat.done,
        total: stat.total,
      }
    })
    .filter((row): row is ProjectProgressRow => row !== null)

  const projectSlugs = new Map(progressRows.map((row) => [row.id, row.workspaceSlug]))

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: t('nav.dashboard') }]} />

      <PageBody className="pt-1">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Assigned to me"
              value={mine.length}
              icon={CircleDot}
              href={`/${params.orgSlug}/my-tasks`}
            />
            <StatTile
              label="Due this week"
              value={dueThisWeek.length}
              icon={CalendarClock}
              tone="warning"
              caption={`Through ${weekEnd}`}
            />
            <StatTile
              label="Overdue"
              value={overdue.length}
              icon={AlertTriangle}
              tone="critical"
              caption={overdue.length > 0 ? 'Needs attention' : 'Nothing overdue'}
            />
            <StatTile label="Active projects" value={activeProjects ?? 0} icon={FolderKanban} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Widget title="My open tasks" action={{ label: 'All', href: `/${params.orgSlug}/reports` }}>
              {mine.length === 0 ? (
                <WidgetEmpty>Nothing assigned to you right now.</WidgetEmpty>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {mine.slice(0, 7).map((task) => {
                    const slug = projectSlugs.get(task.project_id)
                    const href = slug
                      ? `/${params.orgSlug}/${slug}/projects/${task.project_id}/tasks/${task.id}`
                      : null

                    return (
                      <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                        <TaskPriorityIcon priority={task.priority as never} />
                        {href ? (
                          <Link
                            href={href}
                            className="min-w-0 flex-1 truncate text-[13px] transition-colors hover:text-primary"
                          >
                            {task.title}
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
                        )}
                        <DueDate dueDate={task.due_date} today={today} isClosed={false} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </Widget>

            <Widget
              title="Project progress"
              action={{ label: 'Projects', href: `/${params.orgSlug}/settings/workspaces` }}
            >
              {progressRows.length === 0 ? (
                <WidgetEmpty>No active projects yet.</WidgetEmpty>
              ) : (
                <ProjectProgressList orgSlug={params.orgSlug} projects={progressRows} />
              )}
            </Widget>
          </div>

          <Widget title="Recent activity">
            {activity.length === 0 ? (
              <WidgetEmpty>Nothing has changed yet.</WidgetEmpty>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {activity.map((task) => {
                  const slug = projectSlugs.get(task.project_id)
                  const href = slug
                    ? `/${params.orgSlug}/${slug}/projects/${task.project_id}/tasks/${task.id}`
                    : null

                  return (
                    <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar className="h-5 w-5 shrink-0">
                        {task.assignee?.avatar_url ? (
                          <AvatarImage src={task.assignee.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback className="bg-surface-hover text-[9px] font-medium uppercase text-muted-foreground">
                          {initials(task.assignee?.full_name ?? '?')}
                        </AvatarFallback>
                      </Avatar>
                      {href ? (
                        <Link
                          href={href}
                          className="min-w-0 flex-1 truncate text-[13px] transition-colors hover:text-primary"
                        >
                          {task.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
                      )}
                      <span className="label-meta shrink-0 text-faint">
                        {formatRelativeTime(task.updated_at, locale)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Widget>
        </div>
      </PageBody>
    </>
  )
}
