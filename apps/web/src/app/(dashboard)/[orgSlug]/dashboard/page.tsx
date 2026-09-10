import { ORG_ADMIN_ROLES, ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  DEFAULT_DASHBOARD,
  WIDGET_SPECS,
  parseLayout,
  type DashboardWidgetType,
} from '@pm/shared/constants'
import { formatRelativeTime, initials, publicIdToString, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@pm/ui'
import { addDays, format } from 'date-fns'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type * as React from 'react'
import { DashboardGrid } from '@/components/dashboard/dashboard-grid'
import { ProjectProgressList, type ProjectProgressRow } from '@/components/dashboard/project-progress'
import { StatTile } from '@/components/dashboard/stat-tile'
import { Widget, WidgetEmpty } from '@/components/dashboard/widget'
import { Topbar } from '@/components/layout/topbar'
import { DueDate, TaskPriorityIcon } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard' }

interface TaskRow {
  id: string
  /** 16-digit public id — the half of the task's URL that names the task. */
  public_id: number
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
    teamLoad,
  ] = await Promise.all([
      supabase
        .from('tasks')
        .select(
          `id, public_id, title, status, priority, due_date, project_id, updated_at,
           assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
        )
        .eq('assignee_id', auth.userId)
        .not('status', 'in', '(done,cancelled)')
        .order('due_date', { nullsFirst: false })
        .limit(50),
      supabase
        .from('projects')
        .select('id, public_id, name, workspace:workspaces!projects_workspace_id_fkey(slug)')
        .eq('organization_id', auth.orgId)
        .eq('status', 'active')
        .order('name')
        .limit(6),
      // Activity from tasks the viewer can already see; the events table is
      // admin-only by policy, so it would be empty for most roles here.
      supabase
        .from('tasks')
        .select(
          `id, public_id, title, status, priority, due_date, project_id, updated_at,
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

      // Open tasks per person, for the workload widget. Counted here rather
      // than with a group-by because PostgREST has no aggregate for it and the
      // row count this reads is bounded by the cap below.
      isManager
        ? supabase
            .from('tasks')
            .select('assignee_id, assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)')
            .eq('organization_id', auth.orgId)
            .not('status', 'in', '(done,cancelled)')
            .not('assignee_id', 'is', null)
            .limit(1000)
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

  /**
   * Open tasks per person, busiest first.
   *
   * "Workload" here is what the widget's own description promises — open tasks
   * per person — not timesheet hours. It was a placeholder saying analytics
   * "arrive with timesheets in Phase 3", which was both wrong (this needs no
   * timesheet) and a dead panel for anyone who added it.
   */
  const workload = (() => {
    const counts = new Map<string, { name: string; avatar: string | null; open: number }>()
    for (const row of teamLoad.data ?? []) {
      const person = Array.isArray(row.assignee) ? row.assignee[0] : row.assignee
      if (!person) continue
      const entry = counts.get(person.id) ?? {
        name: person.full_name,
        avatar: person.avatar_url,
        open: 0,
      }
      entry.open += 1
      counts.set(person.id, entry)
    }
    const rows = [...counts.entries()].map(([id, value]) => ({ id, ...value }))
    rows.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
    return rows.slice(0, 8)
  })()

  const workloadPeak = workload.reduce((max, row) => Math.max(max, row.open), 0)

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
        publicId: publicIdToString(project.public_id),
        name: project.name,
        workspaceSlug: workspace.slug,
        done: stat.done,
        total: stat.total,
      }
    })
    .filter((row): row is ProjectProgressRow => row !== null)

  // Keyed by uuid because that is what a task's project_id is; the value is
  // everything the link needs, since the URL wants the public id instead.
  const projectLinks = new Map(
    progressRows.map((row) => [row.id, { slug: row.workspaceSlug, publicId: row.publicId }]),
  )

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
        category="pm"
        tone="warning"
        caption={`Through ${weekEnd}`}
      />
    ),
    overdue_tasks: (
      <StatTile
        label="Overdue"
        value={overdue.length}
        category="pm"
        tone="critical"
        caption={overdue.length > 0 ? 'Needs attention' : 'Nothing overdue'}
      />
    ),
    active_projects: (
      <StatTile label="Active projects" value={activeProjects ?? 0} category="pm" />
    ),
    my_open_tasks: (
      <Widget
        title="My open tasks"
        category="pm"
        className="h-full"
        action={{ label: 'All', href: `/${params.orgSlug}/my-tasks` }}
      >
        {mine.length === 0 ? (
          <WidgetEmpty>Nothing assigned to you right now.</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border scrollbar-slim min-h-0 flex-1 overflow-y-auto">
            {mine.slice(0, 12).map((task) => {
              const link = projectLinks.get(task.project_id)
              const href = link
                ? `/${params.orgSlug}/${link.slug}/projects/${link.publicId}/tasks/${publicIdToString(task.public_id)}`
                : null

              return (
                <li key={task.id} className="flex items-center gap-2.5 py-2">
                  <TaskPriorityIcon priority={task.priority as never} />
                  {href ? (
                    <Link
                      href={href}
                      className="min-w-0 flex-1 truncate text-base transition-colors hover:text-primary"
                    >
                      {task.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-base">{task.title}</span>
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
      <Widget title="Project progress" category="pm" className="h-full">
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
      <Widget title="Recently updated" category="pm" className="h-full">
        {activity.length === 0 ? (
          <WidgetEmpty>Nothing has changed yet.</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border scrollbar-slim min-h-0 flex-1 overflow-y-auto">
            {activity.map((task) => {
              const link = projectLinks.get(task.project_id)
              const href = link
                ? `/${params.orgSlug}/${link.slug}/projects/${link.publicId}/tasks/${publicIdToString(task.public_id)}`
                : null

              return (
                <li key={task.id} className="flex items-center gap-2.5 py-2">
                  {/*
                    * The assignee, not an actor — this list has no actor to
                    * show. An unassigned row used to render initials('?') as a
                    * literal question mark, which read as "we don't know who
                    * did this" rather than "nobody owns this yet".
                    */}
                  <Avatar
                    className="h-5 w-5 shrink-0"
                    title={
                      task.assignee ? `Assigned to ${task.assignee.full_name}` : 'Unassigned'
                    }
                  >
                    {task.assignee?.avatar_url ? (
                      <AvatarImage src={task.assignee.avatar_url} alt="" />
                    ) : null}
                    <AvatarFallback className="bg-chip text-[9px] font-medium uppercase text-muted-foreground">
                      {task.assignee ? initials(task.assignee.full_name) : '–'}
                    </AvatarFallback>
                  </Avatar>
                  {href ? (
                    <Link
                      href={href}
                      className="min-w-0 flex-1 truncate text-base transition-colors hover:text-primary"
                    >
                      {task.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-base">{task.title}</span>
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
        category="hr"
        className="h-full"
        action={{ label: 'Request', href: `/${params.orgSlug}/team/leave` }}
      >
        {!leaveBalances.data?.length ? (
          <WidgetEmpty>{me ? 'No leave allocated yet.' : 'No employee record.'}</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border scrollbar-slim min-h-0 flex-1 overflow-y-auto">
            {leaveBalances.data.map((balance) => {
              const type = Array.isArray(balance.leave_type)
                ? balance.leave_type[0]
                : balance.leave_type
              return (
                <li key={balance.id} className="flex items-center gap-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-base">
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
        category="hr"
        className="h-full"
        action={{ label: 'All', href: `/${params.orgSlug}/team/leave` }}
      >
        {!pendingApprovals.data?.length ? (
          <WidgetEmpty>Nothing to approve.</WidgetEmpty>
        ) : (
          <ul className="divide-y divide-border scrollbar-slim min-h-0 flex-1 overflow-y-auto">
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
                <li key={request.id} className="flex items-center gap-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-base">
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
      <Widget title="Team workload" category="pm" className="h-full">
        {workload.length === 0 ? (
          <WidgetEmpty>Nothing is assigned to anyone right now.</WidgetEmpty>
        ) : (
          <ul className="scrollbar-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto pt-1">
            {workload.map((row) => (
              <li key={row.id} className="flex items-center gap-2.5">
                <Avatar className="h-5 w-5 shrink-0">
                  {row.avatar ? <AvatarImage src={row.avatar} alt="" /> : null}
                  <AvatarFallback className="bg-chip text-[9px] font-medium uppercase text-muted-foreground">
                    {initials(row.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-base">{row.name}</span>
                <span className="bg-chip block h-1 w-24 shrink-0 overflow-hidden rounded-sm">
                  <span
                    className="bg-primary block h-full rounded-sm"
                    style={{ width: `${workloadPeak ? (row.open / workloadPeak) * 100 : 0}%` }}
                  />
                </span>
                <span className="text-faint w-6 shrink-0 text-end font-mono text-id tabular-nums">
                  {row.open}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Widget>
    ),
  }

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: t('nav.dashboard') }]} />

      <DashboardGrid
        orgSlug={params.orgSlug}
        name={t('nav.dashboard')}
        // Where the layout in front of you came from: your own saved
        // arrangement, the org's published default, or the built-in starting
        // point — which is shared in the sense that everyone begins there.
        tag={saved.length > 0 ? 'PERSONAL' : orgDefault.length > 0 ? 'ORG DEFAULT' : 'SHARED'}
        initialLayout={layout}
        widgets={widgets}
        availableTypes={availableTypes}
        canPublishDefault={(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)}
      />
    </>
  )
}
