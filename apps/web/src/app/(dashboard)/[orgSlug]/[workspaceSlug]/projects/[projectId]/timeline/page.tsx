import { can } from '@pm/auth/rbac'
import { PLAN_LIMITS, type PlanName } from '@pm/shared/constants'
import { todayIn } from '@pm/shared/utils'
import { Button } from '@pm/ui'
import { Lock } from 'lucide-react'
import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { GanttDependency, GanttTask } from '@/components/gantt/types'
import { PageBody } from '@/components/layout/page-body'
import { ProjectViewTabs } from '@/components/projects/project-tabs'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Timeline' }

// The chart measures DOM and handles pointer events, so server rendering it
// would only produce markup React has to reconcile away (§23.2 rule 1).
const GanttChart = dynamic(
  () => import('@/components/gantt/gantt-chart').then((module) => module.GanttChart),
  {
    ssr: false,
    loading: () => (
      <div className="mx-5 h-80 animate-pulse rounded-lg border border-border bg-surface" />
    ),
  },
)

export default async function TimelinePage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`

  // Gantt is a paid feature (§17). Gate it here rather than rendering an empty
  // chart, so the reason is legible instead of looking broken.
  const plan = (auth.planName ?? 'starter') as PlanName
  if (!PLAN_LIMITS[plan]?.gantt) {
    return (
      <>
        <div className="px-5 py-3">
          <ProjectViewTabs base={base} />
        </div>
        <PageBody>
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <Lock className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-[13px] font-medium">Timeline is not on your plan</p>
            <p className="pt-1 max-w-sm text-[13px] text-muted-foreground">
              Gantt scheduling and task dependencies are included from Growth upward.
            </p>
            <Button asChild size="sm" className="mt-4">
              <Link href={`/${params.orgSlug}/settings/billing`}>See plans</Link>
            </Button>
          </div>
        </PageBody>
      </>
    )
  }

  const [{ data: tasks }, { data: dependencies }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `id, title, task_number, status, priority, start_date, due_date, is_milestone,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
      )
      .eq('project_id', params.projectId)
      .not('status', 'eq', 'cancelled')
      .order('start_date', { nullsFirst: false })
      .order('due_date', { nullsFirst: false })
      .limit(300),
    supabase
      .from('task_dependencies')
      .select('predecessor_id, successor_id, dependency_type')
      .eq('organization_id', auth.orgId),
  ])

  const rows: GanttTask[] = (tasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    taskNumber: task.task_number,
    status: task.status as GanttTask['status'],
    priority: task.priority as GanttTask['priority'],
    startDate: task.start_date,
    dueDate: task.due_date,
    isMilestone: task.is_milestone,
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    assignee: (Array.isArray(task.assignee) ? task.assignee[0] : task.assignee) ?? null,
  }))

  // The dependency query is org-wide because task_dependencies has no project
  // column; narrow to this project's tasks so an edge to another project's task
  // is never drawn.
  const inProject = new Set(rows.map((row) => row.id))
  const edges: GanttDependency[] = (dependencies ?? [])
    .filter((edge) => inProject.has(edge.predecessor_id) && inProject.has(edge.successor_id))
    .map((edge) => ({
      predecessorId: edge.predecessor_id,
      successorId: edge.successor_id,
      type: edge.dependency_type,
    }))

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <ProjectViewTabs base={base} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {rows.length === 0 ? (
          <p className="mx-5 rounded-lg border border-dashed border-border px-4 py-16 text-center text-[13px] text-faint">
            No tasks to schedule yet.
          </p>
        ) : (
          <GanttChart
            scope={params}
            tasks={rows}
            dependencies={edges}
            // "Today" is the organization's today, not the server's (§21.6).
            today={todayIn(auth.orgTimezone)}
            canEdit={can(auth, 'tasks', 'update')}
          />
        )}
      </div>
    </>
  )
}
