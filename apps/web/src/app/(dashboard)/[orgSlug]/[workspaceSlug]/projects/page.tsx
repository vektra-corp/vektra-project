import { can } from '@pm/auth/rbac'
import { initials, publicIdToString, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Button, Card, CardContent, cn } from '@pm/ui'
import { FolderPlus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { ProjectListHeader } from '@/components/projects/project-list-header'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Projects' }

/**
 * The design's six tracks, shared by the header and every row so the two can
 * never drift out of alignment.
 */
const PROJECT_GRID = 'grid-cols-[1.9fr_0.8fr_0.7fr_1.1fr_0.8fr_0.6fr] gap-3.5'

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
  searchParams,
}: {
  params: { orgSlug: string; workspaceSlug: string }
  searchParams?: { scope?: string }
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
    .select('id, public_id, key, name, description, status, priority, start_date, end_date, updated_at')
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

  // Projects the viewer belongs to, for the "Mine" tab. Membership rather than
  // leadership: a contributor's own list should not be empty because someone
  // else owns every project they work on.
  const { data: myRows } = ids.length
    ? await supabase
        .from('project_members')
        .select('project_id')
        .in('project_id', ids)
        .eq('user_id', auth.userId)
    : { data: [] }
  const mine = new Set((myRows ?? []).map((row) => row.project_id))

  const stats = new Map<string, { total: number; done: number }>()
  for (const row of taskRows ?? []) {
    const entry = stats.get(row.project_id) ?? { total: 0, done: 0 }
    entry.total += 1
    if (row.status === 'done' || row.status === 'cancelled') entry.done += 1
    stats.set(row.project_id, entry)
  }

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects`
  const today = todayIn(auth.orgTimezone)

  // The design's three scope tabs. "Mine" is what you lead or contribute to;
  // "At risk" is the derived health, so the tab and the column agree by
  // construction rather than by two rules that could drift apart.
  const scope = typeof searchParams?.scope === 'string' ? searchParams.scope : 'All'

  const rows = (projects ?? [])
    .map((project) => {
      const stat = stats.get(project.id) ?? { total: 0, done: 0 }
      const percent = stat.total === 0 ? 0 : Math.round((stat.done / stat.total) * 100)
      const overdue = Boolean(project.end_date && project.end_date < today && percent < 100)
      return {
        id: project.id,
        publicId: publicIdToString(project.public_id),
        name: project.name,
        client: project.description ?? 'Internal',
        status: project.status,
        percent,
        overdue,
        dot: dotFor(project.id),
        lead: leads.get(project.id) ?? null,
        isMine: mine.has(project.id),
        health: health(percent, stat.total, project.end_date, today),
        dueLabel: project.end_date
          ? overdue
            ? 'OVERDUE'
            : new Date(project.end_date)
                .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                .toUpperCase()
          : '—',
      }
    })
    .filter((row) => {
      if (scope === 'Mine') return row.isMine
      if (scope === 'At risk') return row.health.label === 'At risk' || row.health.label === 'Off track'
      return true
    })

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: workspace.name }, { label: t('title') }]}
      />
      <ProjectListHeader
        title={t('title')}
        orgSlug={params.orgSlug}
        workspaceSlug={params.workspaceSlug}
        base={base}
        canCreate={can(auth, 'projects', 'create')}
      />

      <PageBody className="p-0">
        {rows.length > 0 ? (
          <div>
            {/* The design's six tracks. Repeated on the header and every row,
                so they are declared once and shared. */}
            <div className={cn(PROJECT_GRID, 'border-border label-meta-lg text-subtle grid border-b px-5 py-2.5')}>
              <span>Project</span>
              <span>Status</span>
              <span>Lead</span>
              <span>Progress</span>
              <span>Due</span>
              <span>Health</span>
            </div>

            {rows.map((row) => (
              <Link
                key={row.id}
                href={`${base}/${row.publicId}/list`}
                className={cn(
                  PROJECT_GRID,
                  'border-border hover:bg-surface-hover/40 grid items-center border-b px-5 py-3.5 transition-colors',
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="h-[7px] w-[7px] shrink-0 rounded-sm"
                    style={{ backgroundColor: row.dot }}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-foreground truncate text-task font-medium">
                      {row.name}
                    </span>
                    <span className="text-faint truncate text-micro">{row.client}</span>
                  </span>
                </span>

                <span
                  className={cn(
                    'bg-chip justify-self-start rounded-[5px] px-2 py-[3px] text-[11px] font-semibold uppercase',
                    STATUS_TONE[row.status] ?? 'text-muted-foreground',
                  )}
                >
                  {row.status.replace('_', ' ')}
                </span>

                {row.lead ? (
                  <Avatar className="h-[22px] w-[22px]" title={row.lead.full_name}>
                    {row.lead.avatar_url ? <AvatarImage src={row.lead.avatar_url} alt="" /> : null}
                    <AvatarFallback className="bg-chip text-muted-foreground text-id font-semibold uppercase">
                      {initials(row.lead.full_name)}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <span className="text-subtle text-ui">—</span>
                )}

                <span className="flex items-center gap-[9px]">
                  <span
                    className="bg-chip block h-[5px] flex-1 overflow-hidden rounded-sm"
                    role="progressbar"
                    aria-valuenow={row.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${row.name} progress`}
                  >
                    <span
                      className="block h-full rounded-sm"
                      style={{ width: `${row.percent}%`, backgroundColor: row.dot }}
                    />
                  </span>
                  <span className="text-faint font-mono text-col tabular-nums">{row.percent}%</span>
                </span>

                <span
                  className={cn(
                    'font-mono text-[10.5px] uppercase tabular-nums',
                    row.overdue ? 'text-destructive' : 'text-faint',
                  )}
                >
                  {row.dueLabel}
                </span>

                <span className={cn('text-micro', row.health.tone)}>{row.health.label}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-5 pt-4">
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                <FolderPlus className="text-faint h-8 w-8" aria-hidden />
                <div>
                  <p className="font-medium">
                    {(projects ?? []).length > 0 ? 'Nothing matches this filter' : t('empty_title')}
                  </p>
                  <p className="text-faint text-ui">
                    {(projects ?? []).length > 0
                      ? 'Switch back to All to see every project in this workspace.'
                      : t('empty_body')}
                  </p>
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
