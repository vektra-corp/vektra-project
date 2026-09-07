import { initials, publicIdToString } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, cn } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageBody } from '@/components/layout/page-body'
import { ProjectViewBar } from '@/components/projects/project-tabs'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Workload' }

/**
 * Points one person is expected to carry at once.
 *
 * The design shows a fixed "/ 15 PTS" denominator. There is no capacity field
 * on `employees` or `project_members` to read it from, so it is a constant
 * here rather than an invented column — when capacity becomes real data this
 * is the single place that changes.
 */
const CAPACITY = 15

/**
 * Workload — open points per assignee.
 *
 * Counts only work that is still open: a sprint's load is what remains to be
 * carried, so closed and cancelled tasks drop out rather than inflating
 * everyone's bar for the rest of the cycle.
 */
export default async function WorkloadPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  await requireAuthPage(params.orgSlug)

  const project = await resolveProject(params.projectId)
  if (!project) notFound()

  const supabase = createClient()

  const [{ data: tasks }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `id, public_id, title, status, task_number, estimated_hours,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
      )
      .eq('project_id', project.id)
      .not('status', 'in', '("done","cancelled")')
      .order('position'),
  ])

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`
  const prefix = project.key

  interface Person {
    id: string
    name: string
    avatarUrl: string | null
    points: number
    tasks: { id: string; title: string; number: number }[]
  }

  // Unassigned work is its own row rather than being dropped: it is the load
  // nobody is carrying yet, which is the thing a planner most needs to see.
  const people = new Map<string, Person>()
  for (const task of tasks ?? []) {
    const profile = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee
    const key = profile?.id ?? 'unassigned'
    const entry: Person = people.get(key) ?? {
      id: key,
      name: profile?.full_name ?? 'Unassigned',
      avatarUrl: profile?.avatar_url ?? null,
      points: 0,
      tasks: [],
    }
    entry.points += task.estimated_hours ?? 0
    entry.tasks.push({
      id: publicIdToString(task.public_id),
      title: task.title,
      number: task.task_number,
    })
    people.set(key, entry)
  }

  const rows = [...people.values()].sort((a, b) => b.points - a.points)

  return (
    <>
      <ProjectViewBar base={base}>
        <span className="bg-input hidden h-[18px] w-px sm:block" aria-hidden />
        <span className="label-meta-lg text-subtle">
          {rows.length} {rows.length === 1 ? 'person' : 'people'} · {CAPACITY} pts capacity
        </span>
      </ProjectViewBar>

      <PageBody className="px-5 pt-4">
        {rows.length === 0 ? (
          <p className="text-faint py-16 text-center text-base">
            No open work to distribute yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((person) => {
              const over = person.points > CAPACITY
              const pct = Math.min(100, (person.points / CAPACITY) * 100)
              return (
                <li
                  key={person.id}
                  className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7 shrink-0">
                      {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="bg-chip text-muted-foreground text-[9px] font-medium uppercase">
                        {person.id === 'unassigned' ? '—' : initials(person.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-base font-semibold">{person.name}</span>
                    <span
                      className={cn('label-meta-lg', over ? 'text-destructive' : 'text-primary')}
                    >
                      {over ? 'over capacity' : 'healthy'}
                    </span>
                    <span className="label-id text-faint ms-auto tabular-nums">
                      {person.points} / {CAPACITY} PTS
                    </span>
                  </div>

                  <span
                    className="bg-chip block h-1 overflow-hidden rounded-sm"
                    role="progressbar"
                    aria-valuenow={person.points}
                    aria-valuemin={0}
                    aria-valuemax={CAPACITY}
                    aria-label={`${person.name} load`}
                  >
                    <span
                      className={cn(
                        'block h-full rounded-sm',
                        over ? 'bg-destructive' : 'bg-primary',
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </span>

                  <ul className="flex flex-wrap gap-2">
                    {person.tasks.map((task) => (
                      <li key={task.id}>
                        <Link
                          href={`${base}/tasks/${task.id}`}
                          className="bg-chip hover:text-foreground text-muted-foreground flex items-center gap-2 rounded-md px-2.5 py-1.5 text-ui transition-colors"
                        >
                          <span className="label-id text-faint">
                            {prefix}-{task.number}
                          </span>
                          <span className="max-w-[220px] truncate">{task.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </PageBody>
    </>
  )
}
