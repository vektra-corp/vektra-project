import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { formatDate, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Badge, Progress } from '@pm/ui'
import { CalendarDays } from 'lucide-react'
import type { Metadata } from 'next'
import { Widget, WidgetEmpty } from '@/components/dashboard/widget'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { TeamNav } from '../team-nav'
import { CancelLeaveButton, LeaveDecision, RequestLeaveDialog } from './leave-controls'

export const metadata: Metadata = { title: 'Leave' }

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  approved: 'success',
  rejected: 'destructive',
  cancelled: 'outline',
}

const date = (value: string) => formatDate(value, { locale: 'en', dateFormat: 'YYYY-MM-DD' })

export default async function LeavePage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const canApprove = (ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)
  const supabase = createClient()
  const year = new Date().getFullYear()

  const { data: me } = await supabase
    .from('employees')
    .select('id')
    .eq('organization_id', auth.orgId)
    .eq('user_id', auth.userId)
    .maybeSingle()

  const [{ data: leaveTypes }, { data: balances }, { data: requests }] = await Promise.all([
    supabase
      .from('leave_types')
      .select('id, name, color, default_days')
      .eq('organization_id', auth.orgId)
      .eq('is_active', true)
      .order('name'),
    me
      ? supabase
          .from('leave_balances')
          .select(
            'id, total_days, used_days, pending_days, remaining_days, carried_over, leave_type:leave_types!leave_balances_leave_type_id_fkey(name)',
          )
          .eq('employee_id', me.id)
          .eq('year', year)
      : Promise.resolve({ data: [] as never[] }),
    // RLS decides the scope: a manager sees the organization, everyone else
    // sees only their own requests. The query is the same either way.
    supabase
      .from('leave_requests')
      .select(
        `id, start_date, end_date, duration_days, status, reason, rejection_note, employee_id,
         leave_type:leave_types!leave_requests_leave_type_id_fkey(name, color),
         employee:employees!leave_requests_employee_id_fkey(
           user_id, profile:profiles!employees_user_id_fkey(full_name)
         )`,
      )
      .eq('organization_id', auth.orgId)
      .order('start_date', { ascending: false })
      .limit(100),
  ])

  const rows = (requests ?? []).map((request) => {
    const type = Array.isArray(request.leave_type) ? request.leave_type[0] : request.leave_type
    const employee = Array.isArray(request.employee) ? request.employee[0] : request.employee
    const profile = employee
      ? Array.isArray(employee.profile)
        ? employee.profile[0]
        : employee.profile
      : null

    return {
      id: request.id,
      startDate: request.start_date,
      endDate: request.end_date,
      durationDays: request.duration_days,
      status: request.status,
      reason: request.reason,
      rejectionNote: request.rejection_note,
      typeName: type?.name ?? 'Leave',
      personName: profile?.full_name ?? 'Unknown',
      isMine: request.employee_id === me?.id,
    }
  })

  const pending = rows.filter((row) => row.status === 'pending')
  const mine = rows.filter((row) => row.isMine)
  const upcoming = rows.filter(
    (row) => row.status === 'approved' && row.endDate >= new Date().toISOString().slice(0, 10),
  )

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'Team', href: `/${params.orgSlug}/team` }, { label: 'Leave' }]}
        meta={
          pending.length > 0 && canApprove ? (
            <Badge variant="warning" shape="meta" className="ms-1">
              {pending.length} awaiting
            </Badge>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <TeamNav orgSlug={params.orgSlug} />
        <div className="ms-auto">
          <RequestLeaveDialog
            orgSlug={params.orgSlug}
            leaveTypes={leaveTypes ?? []}
            hasEmployeeRecord={Boolean(me)}
          />
        </div>
      </div>

      <PageBody>
        <div className="space-y-4">
          {!me ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-base text-faint">
              You do not have an employee record, so you cannot request leave yet. An admin can
              create one from the directory.
            </p>
          ) : null}

          {me && balances?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {balances.map((balance) => {
                const type = Array.isArray(balance.leave_type)
                  ? balance.leave_type[0]
                  : balance.leave_type
                const allocated = Number(balance.total_days) + Number(balance.carried_over)
                const consumed = Number(balance.used_days) + Number(balance.pending_days)

                return (
                  <div
                    key={balance.id}
                    className="rounded-lg border border-border bg-surface p-4 shadow-card"
                  >
                    <p className="label-meta text-faint">{type?.name ?? 'Leave'}</p>
                    <p className="pt-2 text-head font-semibold tabular-nums">
                      {balance.remaining_days}
                      <span className="ps-1 text-base font-normal text-faint">
                        of {allocated} left
                      </span>
                    </p>
                    <Progress
                      value={consumed}
                      max={allocated || 1}
                      className="mt-3 h-1.5"
                      aria-label={`${type?.name ?? 'Leave'} used`}
                    />
                    <p className="label-meta pt-2 text-faint">
                      {balance.used_days} taken
                      {Number(balance.pending_days) > 0
                        ? ` · ${balance.pending_days} pending`
                        : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : null}

          {canApprove ? (
            <Widget title={`Awaiting your decision (${pending.length})`}>
              {pending.length === 0 ? (
                <WidgetEmpty>Nothing to approve.</WidgetEmpty>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {pending.map((row) => (
                    <li key={row.id} className="flex items-center gap-2.5 py-2">
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarFallback className="bg-surface-hover text-[9px] font-medium uppercase text-muted-foreground">
                          {initials(row.personName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base">
                          {row.personName}
                          <span className="ps-2 text-muted-foreground">{row.typeName}</span>
                        </p>
                        <p className="label-meta pt-1 text-faint">
                          {date(row.startDate)} → {date(row.endDate)} · {row.durationDays}d
                          {row.reason ? ` · ${row.reason}` : ''}
                        </p>
                      </div>
                      <LeaveDecision orgSlug={params.orgSlug} requestId={row.id} />
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Widget title="My requests">
              {mine.length === 0 ? (
                <WidgetEmpty>You have not requested any leave.</WidgetEmpty>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {mine.slice(0, 10).map((row) => (
                    <li key={row.id} className="flex items-center gap-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base">{row.typeName}</p>
                        <p className="label-meta pt-1 text-faint">
                          {date(row.startDate)} → {date(row.endDate)} · {row.durationDays}d
                        </p>
                        {row.rejectionNote ? (
                          <p className="pt-1 text-nav text-destructive">{row.rejectionNote}</p>
                        ) : null}
                      </div>
                      <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'} shape="meta">
                        {row.status}
                      </Badge>
                      {row.status === 'pending' ? (
                        <CancelLeaveButton orgSlug={params.orgSlug} requestId={row.id} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Widget>

            <Widget title="Who is off">
              {upcoming.length === 0 ? (
                <WidgetEmpty>Nobody is scheduled to be away.</WidgetEmpty>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {upcoming.slice(0, 10).map((row) => (
                    <li key={row.id} className="flex items-center gap-2.5 py-2">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-base">{row.personName}</span>
                      <span className="label-meta text-faint">
                        {date(row.startDate)} → {date(row.endDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          </div>
        </div>
      </PageBody>
    </>
  )
}
