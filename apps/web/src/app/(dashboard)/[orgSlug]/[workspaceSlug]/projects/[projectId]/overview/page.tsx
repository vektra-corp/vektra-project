import { can } from '@pm/auth/rbac'
import type { Priority, TaskStatus } from '@pm/shared/constants'
import { formatCurrency, initials, publicIdToString, todayIn } from '@pm/shared/utils'
import { cn } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { ProjectViewBar } from '@/components/projects/project-tabs'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Overview' }

const STATUS_META: Record<string, { label: string; color: string }> = {
  todo: { label: 'To Do', color: 'hsl(var(--status-backlog))' },
  in_progress: { label: 'In Progress', color: 'hsl(var(--status-progress))' },
  in_review: { label: 'In Review', color: 'hsl(var(--status-review))' },
  done: { label: 'Done', color: 'hsl(var(--status-done))' },
  cancelled: { label: 'Cancelled', color: 'hsl(var(--subtle))' },
}

const PRIORITY_META: Record<string, { label: string; color: string }> = {
  critical: { label: 'URGENT', color: 'hsl(var(--priority-critical))' },
  high: { label: 'HIGH', color: 'hsl(var(--priority-high))' },
  medium: { label: 'MED', color: 'hsl(var(--priority-medium))' },
  low: { label: 'LOW', color: 'hsl(var(--priority-low))' },
}

/** The design's task strip inside the overview card. */
const TASK_GRID = 'grid-cols-[50px_1fr_116px_96px_104px_30px] gap-2.5'

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function shortDate(value: string | null): string {
  if (!value) return '—'
  return new Date(`${value}T00:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase()
}

/** A titled card, as every block on this screen is drawn. */
function Panel({
  title,
  meta,
  action,
  children,
}: {
  title: string
  meta?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-2.5 rounded-[11px] border px-4 py-[15px]">
      <div className="flex items-center gap-2.5">
        <h2 className="label-meta-lg text-subtle">{title}</h2>
        {meta ? <span className="text-subtle font-mono text-meta uppercase">{meta}</span> : null}
        {action ? <span className="ms-auto">{action}</span> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Project overview.
 *
 * The design's project screen: the brief, a completion meter, the milestones,
 * the task list, and a properties rail down the right. It is a sixth project
 * view rather than a separate screen, so it shares the view switcher with the
 * board and the list and can be reached the same way.
 *
 * Milestones are the project's tasks flagged `is_milestone` (§6.2), not a table
 * of their own — a milestone IS a dated piece of work, and giving it a second
 * home would mean two things to keep in step.
 */
export default async function ProjectOverviewPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const locale = await getLocale()

  const resolved = await resolveProject(params.projectId)
  if (!resolved) notFound()

  const supabase = createClient()

  const [{ data: project }, { data: tasks }, { data: members }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, key, description, status, priority, start_date, end_date, budget')
      .eq('id', resolved.id)
      .maybeSingle(),
    supabase
      .from('tasks')
      .select(
        `id, public_id, title, status, priority, due_date, task_number, is_milestone,
         estimated_hours,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name)`,
      )
      .eq('project_id', resolved.id)
      .order('position'),
    supabase
      .from('project_members')
      .select('role, profile:profiles!project_members_user_id_fkey(id, full_name)')
      .eq('project_id', resolved.id),
  ])

  if (!project) notFound()

  const today = todayIn(auth.orgTimezone)
  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`
  const rows = tasks ?? []
  const closed = rows.filter((task) => task.status === 'done' || task.status === 'cancelled')
  const percent = rows.length === 0 ? 0 : Math.round((closed.length / rows.length) * 100)

  const milestones = rows.filter((task) => task.is_milestone)
  const milestonesDone = milestones.filter((task) => task.status === 'done')

  const team = (members ?? [])
    .map((member) => ({ role: member.role, profile: one(member.profile) }))
    .filter((entry): entry is { role: string; profile: { id: string; full_name: string } } =>
      Boolean(entry.profile),
    )
  const lead = team.find((entry) => entry.role === 'owner') ?? team[0] ?? null

  const canEdit = can(auth, 'projects', 'update')

  return (
    <>
      <ProjectViewBar base={base}>
        <span className="bg-input hidden h-[18px] w-px sm:block" aria-hidden />
        <span className="text-subtle font-mono text-col uppercase tabular-nums">
          {project.key} · {closed.length}/{rows.length} done · {percent}%
        </span>
        {canEdit ? (
          <Link
            href={`${base}/settings`}
            className="border-input text-muted-foreground hover:text-foreground ms-auto rounded-[7px] border px-2.5 py-1 text-nav transition-colors"
          >
            Project settings
          </Link>
        ) : null}
      </ProjectViewBar>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-slim flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-[30px] pt-[18px]">
          <Panel title="Brief">
            <p className="text-muted-foreground whitespace-pre-wrap text-task leading-[1.65]">
              {project.description || 'No brief yet. Add one in project settings.'}
            </p>
          </Panel>

          <Panel
            title="Progress"
            action={
              <span className="text-subtle text-micro">
                {closed.length} of {rows.length} tasks closed
              </span>
            }
          >
            <div className="flex items-center gap-3">
              <span
                className="bg-chip block h-[7px] flex-1 overflow-hidden rounded"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${project.name} progress`}
              >
                <span
                  className="bg-primary block h-full rounded"
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-muted-foreground font-mono text-[14px] tabular-nums">
                {percent}%
              </span>
            </div>
          </Panel>

          <Panel
            title="Milestones"
            meta={`${milestonesDone.length}/${milestones.length}`}
          >
            {milestones.length === 0 ? (
              <p className="text-subtle text-micro">
                Flag a task as a milestone to see it here.
              </p>
            ) : (
              <ul className="flex flex-col">
                {milestones.map((task) => (
                  <li
                    key={task.id}
                    className="border-border flex items-center gap-2.5 border-b py-[7px] last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border text-[9px]',
                        task.status === 'done'
                          ? 'border-primary bg-primary text-[#04120F]'
                          : 'border-input text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <Link
                      href={`${base}/tasks/${publicIdToString(task.public_id)}`}
                      className={cn(
                        'hover:text-primary min-w-0 flex-1 truncate text-base transition-colors',
                        task.status === 'done' && 'text-faint line-through',
                      )}
                    >
                      {task.title}
                    </Link>
                    <span className="text-faint shrink-0 font-mono text-[10.5px] tabular-nums">
                      {shortDate(task.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Tasks"
            meta={`${rows.length} · ${closed.length} done`}
            action={
              <Link
                href={`${base}/list`}
                className="text-faint hover:text-foreground text-nav transition-colors"
              >
                Open in list →
              </Link>
            }
          >
            {rows.length === 0 ? (
              <p className="text-subtle text-micro">No tasks in this project yet.</p>
            ) : (
              <div className="flex flex-col">
                <div
                  className={cn(
                    TASK_GRID,
                    'text-subtle grid px-1 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.1em]',
                  )}
                >
                  <span>ID</span>
                  <span>Task</span>
                  <span>Status</span>
                  <span>Priority</span>
                  <span>Due</span>
                  <span title="Assignee">Who</span>
                </div>

                {rows.slice(0, 25).map((task) => {
                  const assignee = one(task.assignee)
                  const status = STATUS_META[task.status as TaskStatus] ?? STATUS_META.todo!
                  const priority = PRIORITY_META[task.priority as Priority] ?? PRIORITY_META.medium!
                  const overdue =
                    task.due_date !== null &&
                    task.due_date < today &&
                    task.status !== 'done' &&
                    task.status !== 'cancelled'

                  return (
                    <Link
                      key={task.id}
                      href={`${base}/tasks/${publicIdToString(task.public_id)}`}
                      className={cn(
                        TASK_GRID,
                        'border-border hover:bg-surface-hover/40 grid items-center border-t px-1 py-2 transition-colors',
                      )}
                    >
                      <span className="text-subtle font-mono text-col tabular-nums">
                        {project.key}-{task.task_number}
                      </span>
                      <span
                        className={cn(
                          'truncate text-base',
                          (task.status === 'done' || task.status === 'cancelled') &&
                            'text-faint line-through',
                        )}
                      >
                        {task.title}
                      </span>
                      <span className="bg-chip text-muted-foreground flex items-center gap-1.5 rounded-[6px] px-[7px] py-1 text-micro">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="truncate">{status.label}</span>
                      </span>
                      <span
                        className="border-input flex items-center gap-1.5 rounded-[6px] border px-[7px] py-1 text-micro"
                        style={{ color: priority.color }}
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: priority.color }}
                        />
                        <span className="truncate">{priority.label}</span>
                      </span>
                      <span
                        className={cn(
                          'border-input rounded-[6px] border px-[7px] py-1 font-mono text-col tabular-nums',
                          overdue ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {shortDate(task.due_date)}
                      </span>
                      <span
                        className="bg-chip text-muted-foreground grid h-[23px] w-[23px] place-items-center rounded-full text-meta font-semibold uppercase"
                        title={assignee?.full_name ?? 'Unassigned'}
                      >
                        {assignee ? initials(assignee.full_name) : '—'}
                      </span>
                    </Link>
                  )
                })}

                {rows.length > 25 ? (
                  <Link
                    href={`${base}/list`}
                    className="border-border text-primary border-t px-1 py-2.5 text-nav transition-colors hover:underline"
                  >
                    Show all {rows.length} tasks
                  </Link>
                ) : null}
              </div>
            )}
          </Panel>
        </div>

        <aside className="border-border scrollbar-slim hidden w-[302px] shrink-0 flex-col gap-3.5 overflow-y-auto border-s px-4 pb-7 pt-4 lg:flex">
          <div className="flex flex-col gap-[9px]">
            <h2 className="label-meta-lg text-subtle">Properties</h2>

            <div className="flex items-center gap-2.5">
              <span className="text-faint w-[78px] shrink-0 text-nav">Lead</span>
              {lead ? (
                <span className="flex items-center gap-2">
                  <span className="bg-chip text-muted-foreground grid h-[21px] w-[21px] place-items-center rounded-full text-meta font-semibold uppercase">
                    {initials(lead.profile.full_name)}
                  </span>
                  <span className="text-ui">{lead.profile.full_name}</span>
                </span>
              ) : (
                <span className="text-subtle text-ui">Unassigned</span>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-faint w-[78px] shrink-0 text-nav">Status</span>
              <span className="text-muted-foreground text-ui capitalize">
                {project.status.replace('_', ' ')}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-faint w-[78px] shrink-0 text-nav">Priority</span>
              <span className="text-muted-foreground text-ui capitalize">
                {project.priority ?? '—'}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-faint w-[78px] shrink-0 text-nav">Start</span>
              <span className="text-muted-foreground font-mono text-micro tabular-nums">
                {shortDate(project.start_date)}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-faint w-[78px] shrink-0 text-nav">Target</span>
              <span className="text-muted-foreground font-mono text-micro tabular-nums">
                {shortDate(project.end_date)}
              </span>
            </div>
          </div>

          <div className="border-border flex flex-col gap-[9px] border-t pt-[13px]">
            <h2 className="label-meta-lg text-subtle">Budget</h2>
            <div className="flex items-center gap-2.5">
              <span className="text-faint w-[78px] shrink-0 text-nav">Approved</span>
              <span className="text-muted-foreground font-mono text-micro tabular-nums">
                {project.budget === null
                  ? '—'
                  : formatCurrency(Number(project.budget), auth.orgCurrency, locale)}
              </span>
            </div>
          </div>

          <div className="border-border flex flex-col gap-[9px] border-t pt-[13px]">
            <h2 className="label-meta-lg text-subtle">Team</h2>
            {team.length === 0 ? (
              <p className="text-subtle text-micro">Nobody has been added yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-[7px]">
                {team.map((entry) => (
                  <li
                    key={entry.profile.id}
                    className="bg-chip text-muted-foreground flex items-center gap-[7px] rounded-[20px] py-1 pe-2 ps-[5px] text-nav"
                  >
                    <span className="bg-card grid h-[19px] w-[19px] place-items-center rounded-full text-[8.5px] font-semibold uppercase">
                      {initials(entry.profile.full_name)}
                    </span>
                    {entry.profile.full_name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
