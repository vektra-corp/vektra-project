import { initials } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Button, Card, CardContent, cn } from '@pm/ui'
import { FolderPlus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Projects' }

/**
 * Per-project identity colour.
 *
 * The design gives every project a distinct dot. There is no `projects.color`
 * column, so rather than ship a migration for decoration the hue is derived
 * from the id — stable across renders and machines, and distinct enough between
 * neighbours to do the job the design asks of it.
 */
const DOTS = [
  'hsl(var(--status-progress))',
  'hsl(var(--status-review))',
  'hsl(var(--status-done))',
  'hsl(var(--status-testing))',
  'hsl(var(--priority-critical))',
]
function dotFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  // Indexed access is checked, and a modulo cannot miss — the fallback is for
  // the type system, not for a case that can occur.
  return DOTS[hash % DOTS.length] ?? 'hsl(var(--status-progress))'
}

/** Status pill colouring, keyed by the project lifecycle. */
const STATUS_TONE: Record<string, string> = {
  active: 'text-primary',
  on_hold: 'text-warning',
  completed: 'text-status-done',
  archived: 'text-faint',
}

/**
 * Delivery health, derived rather than stored.
 *
 * The design shows a health column; the schema has no such field, so it is
 * computed from the two things that actually determine it — how much is done
 * and how much time is left. The rule is deliberately blunt so it is easy to
 * reason about: nothing started is "not started", past its end date is "off
 * track", inside a week of the end date with under 70% done is "at risk".
 */
function health(
  percent: number,
  total: number,
  endDate: string | null,
  today: string,
): { label: string; tone: string } {
  if (total === 0) return { label: 'Not started', tone: 'text-faint' }
  if (percent >= 100) return { label: 'Complete', tone: 'text-status-done' }
  if (endDate && endDate < today) return { label: 'Off track', tone: 'text-destructive' }
  if (endDate) {
    const daysLeft = Math.round(
      (new Date(endDate).getTime() - new Date(today).getTime()) / 86_400_000,
    )
    if (daysLeft <= 7 && percent < 70) return { label: 'At risk', tone: 'text-warning' }
  }
  return { label: 'On track', tone: 'text-primary' }
}

export default async function ProjectsPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const t = await getTranslations('projects')
  const supabase = createClient()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('organization_id', auth.orgId)
    .eq('slug', params.workspaceSlug)
    .maybeSingle()

  if (!workspace) notFound()

  // RLS already restricts this to projects the user can reach, so no further
  // visibility filtering is needed here.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, status, priority, start_date, end_date, updated_at')
    .eq('workspace_id', workspace.id)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  // One grouped count instead of a query per row.
  const ids = (projects ?? []).map((p) => p.id)
  const { data: taskRows } = ids.length
    ? await supabase.from('tasks').select('project_id, status').in('project_id', ids)
    : { data: [] }

  // Leads in one pass too, for the same reason.
  const { data: leadRows } = ids.length
    ? await supabase
        .from('project_members')
        .select(
          'project_id, profile:profiles!project_members_user_id_fkey(id, full_name, avatar_url)',
        )
        .in('project_id', ids)
        .eq('role', 'owner')
    : { data: [] }

  const leads = new Map<string, { full_name: string; avatar_url: string | null }>()
  for (const row of leadRows ?? []) {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    if (profile && !leads.has(row.project_id)) leads.set(row.project_id, profile)
  }

  const stats = new Map<string, { total: number; done: number }>()
  for (const row of taskRows ?? []) {
    const entry = stats.get(row.project_id) ?? { total: 0, done: 0 }
    entry.total += 1
    if (row.status === 'done' || row.status === 'cancelled') entry.done += 1
    stats.set(row.project_id, entry)
  }

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects`
  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: workspace.name }, { label: t('title') }]}
      />
      <PageBody className="p-0">
        <div className="flex items-center gap-3 px-5 py-3.5">
          <h1 className="text-head font-semibold">{t('title')}</h1>
          <span className="label-meta-lg text-subtle">{workspace.name}</span>
          <Button asChild size="sm" className="ms-auto">
            <Link href={`${base}/new`}>{t('create')}</Link>
          </Button>
        </div>

        {projects && projects.length > 0 ? (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-border border-y">
                <th className="label-meta text-subtle px-5 py-2 text-start font-normal">Project</th>
                <th className="label-meta text-subtle py-2 pe-3 text-start font-normal">Status</th>
                <th className="label-meta text-subtle py-2 pe-3 text-start font-normal">Lead</th>
                <th className="label-meta text-subtle py-2 pe-3 text-start font-normal">
                  Progress
                </th>
                <th className="label-meta text-subtle py-2 pe-3 text-start font-normal">Due</th>
                <th className="label-meta text-subtle px-5 py-2 text-start font-normal">Health</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const stat = stats.get(project.id) ?? { total: 0, done: 0 }
                const percent = stat.total === 0 ? 0 : Math.round((stat.done / stat.total) * 100)
                const lead = leads.get(project.id)
                const dot = dotFor(project.id)
                const overdue = Boolean(
                  project.end_date && project.end_date < today && percent < 100,
                )
                const state = health(percent, stat.total, project.end_date, today)

                return (
                  <tr
                    key={project.id}
                    className="border-border hover:bg-surface-hover/40 border-b transition-colors"
                  >
                    <td className="px-5 py-3">
                      <Link href={`${base}/${project.id}/board`} className="flex items-start gap-3">
                        <span
                          aria-hidden
                          className="mt-1.5 h-[7px] w-[7px] shrink-0 rounded-sm"
                          style={{ backgroundColor: dot }}
                        />
                        <span className="min-w-0">
                          <span className="text-foreground block truncate text-base font-semibold">
                            {project.name}
                          </span>
                          {project.description ? (
                            <span className="text-faint block truncate pt-0.5 text-ui">
                              {project.description}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </td>

                    <td className="py-3 pe-3">
                      <span
                        className={cn(
                          'bg-chip inline-flex rounded-sm px-2 py-[3px] text-micro font-medium uppercase',
                          STATUS_TONE[project.status] ?? 'text-muted-foreground',
                        )}
                      >
                        {project.status.replace('_', ' ')}
                      </span>
                    </td>

                    <td className="py-3 pe-3">
                      {lead ? (
                        <Avatar className="h-[22px] w-[22px]" title={lead.full_name}>
                          {lead.avatar_url ? <AvatarImage src={lead.avatar_url} alt="" /> : null}
                          <AvatarFallback className="bg-chip text-muted-foreground text-[9px] font-medium uppercase">
                            {initials(lead.full_name)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <span className="text-subtle text-ui">—</span>
                      )}
                    </td>

                    <td className="py-3 pe-3">
                      <span className="flex items-center gap-2.5">
                        <span
                          className="bg-chip block h-1 w-[140px] overflow-hidden rounded-sm"
                          role="progressbar"
                          aria-valuenow={percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${project.name} progress`}
                        >
                          <span
                            className="block h-full rounded-sm"
                            style={{ width: `${percent}%`, backgroundColor: dot }}
                          />
                        </span>
                        <span className="label-id text-faint">{percent}%</span>
                      </span>
                    </td>

                    <td className="py-3 pe-3">
                      <span
                        className={cn('label-id', overdue ? 'text-destructive' : 'text-faint')}
                      >
                        {project.end_date
                          ? overdue
                            ? 'OVERDUE'
                            : new Date(project.end_date)
                                .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                                .toUpperCase()
                          : '—'}
                      </span>
                    </td>

                    <td className={cn('px-5 py-3 text-ui', state.tone)}>{state.label}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="px-5 pt-4">
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <FolderPlus className="text-faint h-8 w-8" aria-hidden />
                <div>
                  <p className="font-medium">{t('empty_title')}</p>
                  <p className="text-faint text-ui">{t('empty_body')}</p>
                </div>
                <Button asChild size="sm">
                  <Link href={`${base}/new`}>{t('create')}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </PageBody>
    </>
  )
}
