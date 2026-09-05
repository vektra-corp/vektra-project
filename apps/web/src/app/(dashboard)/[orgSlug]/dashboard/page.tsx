import { ORG_ADMIN_ROLES, ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  DEFAULT_DASHBOARD,
  WIDGET_SPECS,
  parseLayout,
  type DashboardWidgetType,
} from '@pm/shared/constants'
import { formatRelativeTime, initials, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@pm/ui'
import { addDays, format } from 'date-fns'
import { AlertTriangle, CalendarClock, FolderKanban } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type * as React from 'react'
import { DashboardGrid } from '@/components/dashboard/dashboard-grid'
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

  const isManager = (ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)

  /*
   * Everything that depends on nothing, in one round trip.
   *
   * These were four separate waves. Each wave is a full round trip to the
   * database, and this project's is in another region — about 370ms each, so
   * the ordering cost more than the queries did. Only two things genuinely
   * depend on an earlier result, and they are the wave below.
   */
  const [
    { data: myTasks },
    { data: projects },
    { data: recent },
    { count: activeProjects },
    { data: me },
    { data: config },
    { data: organization },
    pendingApprovals,
  ] = await Promise.all([
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

      // The viewer's own employee record, if they have one — the leave widgets
      // are meaningless without it and are omitted rather than shown empty.
      supabase
        .from('employees')
        .select('id')
        .eq('organization_id', auth.orgId)
        .eq('user_id', auth.userId)
        .maybeSingle(),

      // The saved layout is per person per org; absence means "never
      // customised", which is what keeps DEFAULT_DASHBOARD the single
      // definition of the default.
      supabase
        .from('dashboard_configs')
        .select('layout')
        .eq('organization_id', auth.orgId)
        .eq('user_id', auth.userId)
        .eq('is_default', true)
        .maybeSingle(),

      supabase.from('organizations').select('settings').eq('id', auth.orgId).maybeSingle(),

      isManager
        ? supabase
            .from('leave_requests')
            .select(
              'id, start_date, end_date, duration_days, employee:employees!leave_requests_employee_id_fkey(profile:profiles!employees_user_id_fkey(full_name))',
            )
            .eq('organization_id', auth.orgId)
            .eq('status', 'pending')
            .order('start_date')
            .limit(8)
        : Promise.resolve({ data: [] as never[] }),
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

  /*
   * The second and last wave: the two queries that need a result from the first.
   * `projectTasks` needs the project ids; `leaveBalances` needs the viewer's
   * employee row.
   */
  const [{ data: projectTasks }, leaveBalances] = await Promise.all([
    projectIds.length
      ? supabase.from('tasks').select('project_id, status').in('project_id', projectIds)
      : Promise.resolve({ data: [] as { project_id: string; status: string }[] }),
    me
      ? supabase
          .from('leave_balances')
          .select(
            'id, remaining_days, total_days, carried_over, leave_type:leave_types!leave_balances_leave_type_id_fkey(name)',
          )
          .eq('employee_id', me.id)
          .eq('year', new Date().getFullYear())
      : Promise.resolve({ data: [] as never[] }),
  ])

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

  // Three tiers, most specific first: what this person arranged, then the
  // template an admin published for the organisation (§19.10), then the
  // built-in. Each is only consulted when the one before it is absent, so
  // "never customised" stays distinguishable from "customised to empty".
  const saved = parseLayout(config?.layout)
  const orgDefault = parseLayout(
    (organization?.settings as { dashboard_layout?: unknown } | null)?.dashboard_layout,
  )
  const layout = saved.length > 0 ? saved : orgDefault.length > 0 ? orgDefault : DEFAULT_DASHBOARD

  const availableTypes = (Object.keys(WIDGET_SPECS) as DashboardWidgetType[]).filter(
    (type) => !WIDGET_SPECS[type].managerOnly || isManager,
  )

  const widgets: Partial<Record<DashboardWidgetType, React.ReactNode>> = {
    tasks_due_soon: (
      <StatTile
        label="Due this week"
        value={dueThisWeek.length}
        icon={CalendarClock}
        tone="warning"
        caption={`Through ${weekEnd}`}
      />
    ),
    overdue_tasks: (
      <StatTile
        label="Overdue"
        value={overdue.length}
        icon={AlertTriangle}
        tone="critical"
        caption={overdue.length > 0 ? 'Needs attention' : 'Nothing overdue'}
      />
    ),
    active_projects: <StatTile label="Active projects" value={activeProjects ?? 0} icon={FolderKanban} />,
    my_open_tasks: (
      <Widget
        title="My open tasks"
        className="h-full"
        action={{ label: 'All', href: `/${params.orgSlug}/my-tasks` }}
      >
        {mine.length === 0 ? (
          <WidgetEmpty>Nothing assigned to you right now.</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-y-auto">
            {mine.slice(0, 12).map((task) => {
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
    ),
    project_progress: (
      <Widget title="Project progress" className="h-full">
        {progressRows.length === 0 ? (
          <WidgetEmpty>No active projects yet.</WidgetEmpty>
        ) : (
          <div className="overflow-y-auto">
            <ProjectProgressList orgSlug={params.orgSlug} projects={progressRows} />
          </div>
        )}
      </Widget>
    ),
    recent_activity: (
      <Widget title="Recent activity" className="h-full">
        {activity.length === 0 ? (
          <WidgetEmpty>Nothing has changed yet.</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-y-auto">
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
    ),
    my_leave: (
      <Widget
        title="My leave"
        className="h-full"
        action={{ label: 'Request', href: `/${params.orgSlug}/team/leave` }}
      >
        {!leaveBalances.data?.length ? (
          <WidgetEmpty>{me ? 'No leave allocated yet.' : 'No employee record.'}</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-y-auto">
            {leaveBalances.data.map((balance) => {
              const type = Array.isArray(balance.leave_type)
                ? balance.leave_type[0]
                : balance.leave_type
              return (
                <li key={balance.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {type?.name ?? 'Leave'}
                  </span>
                  <span className="label-meta tabular-nums text-faint">
                    <span className="text-foreground">{balance.remaining_days}</span> left of{' '}
                    {Number(balance.total_days) + Number(balance.carried_over)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Widget>
    ),
    pending_approvals: (
      <Widget
        title="Leave approvals"
        className="h-full"
        action={{ label: 'All', href: `/${params.orgSlug}/team/leave` }}
      >
        {!pendingApprovals.data?.length ? (
          <WidgetEmpty>Nothing to approve.</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-y-auto">
            {pendingApprovals.data.map((request) => {
              const employee = Array.isArray(request.employee)
                ? request.employee[0]
                : request.employee
              const profile = employee
                ? Array.isArray(employee.profile)
                  ? employee.profile[0]
                  : employee.profile
                : null

              return (
                <li key={request.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {profile?.full_name ?? 'Unknown'}
                  </span>
                  <span className="label-meta text-faint">
                    {request.start_date} · {request.duration_days}d
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Widget>
    ),
    team_workload: (
      <Widget title="Team workload" className="h-full">
        <WidgetEmpty>Workload analytics arrive with timesheets in Phase 3.</WidgetEmpty>
      </Widget>
    ),
  }

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: t('nav.dashboard') }]} />

      <PageBody className="pt-1">
        <DashboardGrid
          orgSlug={params.orgSlug}
          initialLayout={layout}
          widgets={widgets}
          availableTypes={availableTypes}
          canPublishDefault={(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)}
        />
      </PageBody>
    </>
  )
}
