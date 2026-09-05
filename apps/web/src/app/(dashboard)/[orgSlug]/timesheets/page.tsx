import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { initials, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Badge } from '@pm/ui'
import { addDays, endOfWeek, format, startOfWeek, subDays } from 'date-fns'
import type { Metadata } from 'next'
import { Widget, WidgetEmpty } from '@/components/dashboard/widget'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { EntryList, formatDuration, type TimeEntryRow } from './entry-list'
import { Timer, type RunningEntry } from './timer'
import {
  ManualEntryDialog,
  SubmitWeekButton,
  TimesheetDecision,
  WeekNav,
} from './timesheet-controls'

export const metadata: Metadata = { title: 'Timesheets' }

/** Parse `?week=` as a calendar date, falling back to the current week. */
function resolveWeek(raw: string | undefined, today: string): Date {
  const candidate = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today
  // Weeks start Monday, matching the ISO convention used elsewhere.
  return startOfWeek(new Date(`${candidate}T00:00:00`), { weekStartsOn: 1 })
}

export default async function TimesheetsPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string }
  searchParams: { week?: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const isManager = (ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)
  const supabase = createClient()

  // "This week" is the organization's week, not the server's (§21.6).
  const today = todayIn(auth.orgTimezone)
  const weekStart = resolveWeek(searchParams.week, today)
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })

  const startIso = format(weekStart, 'yyyy-MM-dd')
  const endIso = format(weekEnd, 'yyyy-MM-dd')
  const currentWeekStart = format(startOfWeek(new Date(`${today}T00:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const [{ data: entries }, { data: projects }, { data: period }, { data: pending }] =
    await Promise.all([
      supabase
        .from('time_entries')
        .select(
          `id, start_time, description, duration_minutes, is_billable, is_running,
           project:projects!time_entries_project_id_fkey(name),
           task:tasks!time_entries_task_id_fkey(title)`,
        )
        .eq('user_id', auth.userId)
        .eq('organization_id', auth.orgId)
        .gte('start_time', `${startIso}T00:00:00Z`)
        .lte('start_time', `${endIso}T23:59:59Z`)
        .order('start_time', { ascending: false }),
      supabase
        .from('projects')
        .select('id, name')
        .eq('organization_id', auth.orgId)
        .eq('status', 'active')
        .order('name'),
      supabase
        .from('timesheet_periods')
        .select('id, status, total_hours, billable_hours, rejection_note')
        .eq('user_id', auth.userId)
        .eq('organization_id', auth.orgId)
        .eq('period_start', startIso)
        .maybeSingle(),
      isManager
        ? supabase
            .from('timesheet_periods')
            .select(
              `id, user_id, period_start, period_end, total_hours, billable_hours,
               profile:profiles!timesheet_periods_user_id_fkey(full_name)`,
            )
            .eq('organization_id', auth.orgId)
            .eq('status', 'submitted')
            .order('period_start', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] as never[] }),
    ])

  const one = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value

  const running = (entries ?? []).find((entry) => entry.is_running)
  const runningEntry: RunningEntry | null = running
    ? {
        id: running.id,
        startedAt: running.start_time,
        description: running.description,
        projectName: one(running.project)?.name ?? 'Unknown project',
      }
    : null

  const rows: TimeEntryRow[] = (entries ?? [])
    .filter((entry) => !entry.is_running)
    .map((entry) => ({
      id: entry.id,
      day: entry.start_time.slice(0, 10),
      description: entry.description,
      projectName: one(entry.project)?.name ?? 'Unknown project',
      taskTitle: one(entry.task)?.title ?? null,
      durationMinutes: entry.duration_minutes,
      isBillable: entry.is_billable,
    }))

  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0)
  const billableMinutes = rows
    .filter((row) => row.isBillable)
    .reduce((sum, row) => sum + row.durationMinutes, 0)

  // A submitted or approved week is a number a manager is acting on; editing it
  // underneath them is refused by the action too.
  const locked = period?.status === 'submitted' || period?.status === 'approved'
  const base = `/${params.orgSlug}/timesheets`

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'Timesheets' }]}
        meta={
          isManager && (pending?.length ?? 0) > 0 ? (
            <Badge variant="warning" shape="meta" className="ms-1">
              {pending!.length} awaiting
            </Badge>
          ) : null
        }
      />

      <PageBody className="pt-1">
        <div className="space-y-4">
          <Timer orgSlug={params.orgSlug} running={runningEntry} projects={projects ?? []} />

          <div className="flex flex-wrap items-center gap-3">
            <WeekNav
              base={base}
              weekStart={startIso}
              previousWeek={format(subDays(weekStart, 7), 'yyyy-MM-dd')}
              nextWeek={format(addDays(weekStart, 7), 'yyyy-MM-dd')}
              label={`${format(weekStart, 'd MMM')} – ${format(weekEnd, 'd MMM yyyy')}`}
              isCurrent={startIso === currentWeekStart}
            />

            <p className="label-meta text-faint">
              <span className="text-foreground">{formatDuration(totalMinutes)}</span> total
              <span className="px-1.5 opacity-50">·</span>
              {formatDuration(billableMinutes)} billable
            </p>

            <div className="ms-auto flex items-center gap-2">
              <ManualEntryDialog
                orgSlug={params.orgSlug}
                projects={projects ?? []}
                defaultDate={startIso <= today && today <= endIso ? today : startIso}
                disabled={locked}
              />
              <SubmitWeekButton
                orgSlug={params.orgSlug}
                periodStart={startIso}
                periodEnd={endIso}
                status={period?.status ?? null}
                totalMinutes={totalMinutes}
              />
            </div>
          </div>

          {period?.status === 'rejected' && period.rejection_note ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-base text-destructive">
              Returned by your manager: {period.rejection_note}
            </p>
          ) : null}

          <EntryList orgSlug={params.orgSlug} entries={rows} locked={locked} />

          {isManager ? (
            <Widget title={`Awaiting your approval (${pending?.length ?? 0})`}>
              {!pending?.length ? (
                <WidgetEmpty>No timesheets to review.</WidgetEmpty>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {pending.map((row) => {
                    const profile = one(row.profile)
                    return (
                      <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar className="h-6 w-6 shrink-0">
                          <AvatarFallback className="bg-surface-hover text-[9px] font-medium uppercase text-muted-foreground">
                            {initials(profile?.full_name ?? '?')}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base">{profile?.full_name ?? 'Unknown'}</p>
                          <p className="label-meta pt-1 text-faint">
                            {row.period_start} → {row.period_end}
                          </p>
                        </div>
                        <span className="label-meta tabular-nums text-muted-foreground">
                          {row.total_hours}h
                          <span className="px-1 opacity-50">·</span>
                          {row.billable_hours}h billable
                        </span>
                        <TimesheetDecision orgSlug={params.orgSlug} periodId={row.id} />
                      </li>
                    )
                  })}
                </ul>
              )}
            </Widget>
          ) : null}
        </div>
      </PageBody>
    </>
  )
}
