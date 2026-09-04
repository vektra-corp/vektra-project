import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { formatDate, initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge } from '@pm/ui'
import { Users } from 'lucide-react'
import type { Metadata } from 'next'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { EmployeeDialog, type EmployeeRecord, type PersonOption } from './employee-dialog'
import { TeamNav } from './team-nav'

export const metadata: Metadata = { title: 'Team' }

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'outline' | 'secondary'> = {
  active: 'success',
  on_leave: 'warning',
  probation: 'secondary',
  terminated: 'outline',
}

export default async function TeamPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const canManage = (ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)
  const supabase = createClient()

  const [{ data: employees }, { data: members }] = await Promise.all([
    supabase
      .from('employees')
      .select(
        `id, user_id, employee_code, department, designation, employment_type,
         date_of_joining, date_of_exit, manager_id, skills, status,
         profile:profiles!employees_user_id_fkey(full_name, avatar_url)`,
      )
      .eq('organization_id', auth.orgId)
      .order('date_of_joining'),
    supabase
      .from('org_members')
      .select('user_id, profile:profiles!org_members_user_id_fkey(full_name)')
      .eq('organization_id', auth.orgId),
  ])

  const rows = (employees ?? []).map((employee) => {
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    const profile = Array.isArray(employee.profile) ? employee.profile[0] : employee.profile
    return {
      record: {
        id: employee.id,
        userId: employee.user_id,
        fullName: profile?.full_name ?? 'Unknown',
        employeeCode: employee.employee_code,
        department: employee.department,
        designation: employee.designation,
        employmentType: employee.employment_type,
        dateOfJoining: employee.date_of_joining,
        dateOfExit: employee.date_of_exit,
        managerId: employee.manager_id,
        skills: employee.skills ?? [],
        status: employee.status,
      } satisfies EmployeeRecord,
      avatarUrl: profile?.avatar_url ?? null,
    }
  })

  const byId = new Map(rows.map((row) => [row.record.id, row.record.fullName]))

  // Only members who do not already have a record can be added.
  const taken = new Set(rows.map((row) => row.record.userId))
  const candidates: PersonOption[] = (members ?? [])
    .map((member) => {
      const profile = Array.isArray(member.profile) ? member.profile[0] : member.profile
      return profile ? { userId: member.user_id, fullName: profile.full_name } : null
    })
    .filter((person): person is PersonOption => person !== null && !taken.has(person.userId))

  const managerOptions = rows.map((row) => ({ id: row.record.id, fullName: row.record.fullName }))

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'Team' }]}
        meta={
          <Badge variant="secondary" shape="meta" className="ms-1">
            {rows.length} employees
          </Badge>
        }
      />

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <TeamNav orgSlug={params.orgSlug} />
        {canManage ? (
          <div className="ms-auto">
            <EmployeeDialog
              orgSlug={params.orgSlug}
              candidates={candidates}
              managers={managerOptions}
            />
          </div>
        ) : null}
      </div>

      <PageBody>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <Users className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-[13px] text-muted-foreground">No employee records yet.</p>
            <p className="pt-1 text-xs text-faint">
              {canManage
                ? 'Add a record for each member to track leave and rates.'
                : 'An admin needs to create these.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {rows.map(({ record, avatarUrl }) => (
              <li key={record.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar className="h-8 w-8">
                  {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
                  <AvatarFallback className="bg-surface-hover text-[10px] font-medium uppercase text-muted-foreground">
                    {initials(record.fullName)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[13px] font-medium">
                    <span className="truncate">{record.fullName}</span>
                    {record.employeeCode ? (
                      <span className="label-meta text-faint">{record.employeeCode}</span>
                    ) : null}
                  </p>
                  <p className="label-meta pt-1 text-faint">
                    {[record.designation, record.department].filter(Boolean).join(' · ') ||
                      record.employmentType.replace('_', ' ')}
                    {record.managerId ? ` · reports to ${byId.get(record.managerId) ?? '—'}` : ''}
                  </p>
                </div>

                {record.skills.length > 0 ? (
                  <span className="hidden max-w-40 truncate lg:block">
                    <span className="label-meta text-faint">{record.skills.join(', ')}</span>
                  </span>
                ) : null}

                <span className="label-meta hidden w-24 text-end text-faint sm:block">
                  {formatDate(record.dateOfJoining, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
                </span>

                <Badge variant={STATUS_VARIANT[record.status] ?? 'secondary'} shape="meta">
                  {record.status.replace('_', ' ')}
                </Badge>

                {canManage ? (
                  <EmployeeDialog
                    orgSlug={params.orgSlug}
                    employee={record}
                    candidates={candidates}
                    managers={managerOptions}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  )
}
