import { can } from '@pm/auth/rbac'
import type { Priority } from '@pm/shared/constants'
import { projectKey } from '@pm/shared/utils'
import type { Metadata } from 'next'
import { ProjectViewTabs } from '@/components/projects/project-tabs'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { PlanningBoard, type PlanningItem } from './planning-board'

export const metadata: Metadata = { title: 'Planning' }

/** Points a sprint is assumed to hold. See the note on Workload's CAPACITY. */
const SPRINT_CAPACITY = 40

export default async function PlanningPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: tasks }, { data: project }, { data: sprints }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `id, title, task_number, priority, estimated_hours, sprint_id, status,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name),
         task_labels(label:labels(id, name, color))`,
      )
      .eq('project_id', params.projectId)
      .not('status', 'in', '("done","cancelled")')
      .order('position'),
    supabase.from('projects').select('name').eq('id', params.projectId).maybeSingle(),
    supabase
      .from('sprints')
      .select('id, name, starts_on, ends_on, status')
      .eq('project_id', params.projectId)
      .in('status', ['active', 'planned'])
      .order('starts_on'),
  ])

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`
  const prefix = projectKey(project?.name ?? '')

  // The design's epic is this schema's label: a project-scoped, coloured
  // grouping of tasks. A task with several labels plans under its first —
  // planning needs each item to appear exactly once, and a task listed under
  // two epics could be committed twice.
  const items: PlanningItem[] = (tasks ?? []).map((task) => {
    const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee
    const first = (task.task_labels ?? [])
      .map((row) => (Array.isArray(row.label) ? row.label[0] : row.label))
      .filter(Boolean)[0]

    return {
      id: task.id,
      title: task.title,
      number: task.task_number,
      priority: task.priority as Priority,
      points: task.estimated_hours ?? 0,
      assigneeId: assignee?.id ?? null,
      assigneeName: assignee?.full_name ?? null,
      groupId: first?.id ?? null,
      groupName: first?.name ?? 'No epic',
      groupColor: first?.color ?? null,
      sprintId: task.sprint_id,
    }
  })

  const sprint = (sprints ?? [])[0] ?? null

  return (
    <>
      <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2.5">
        <ProjectViewTabs base={base} />
        <span className="bg-input hidden h-[18px] w-px sm:block" aria-hidden />
        <span className="label-meta-lg text-subtle">
          {items.filter((item) => !item.sprintId).length} items
        </span>
      </div>

      <PlanningBoard
        scope={params}
        prefix={prefix}
        backlog={items.filter((item) => !item.sprintId)}
        committed={sprint ? items.filter((item) => item.sprintId === sprint.id) : []}
        sprint={
          sprint
            ? {
                id: sprint.id,
                name: sprint.name,
                startsOn: sprint.starts_on,
                endsOn: sprint.ends_on,
              }
            : null
        }
        capacity={SPRINT_CAPACITY}
        canEdit={can(auth, 'tasks', 'update')}
      />
    </>
  )
}
