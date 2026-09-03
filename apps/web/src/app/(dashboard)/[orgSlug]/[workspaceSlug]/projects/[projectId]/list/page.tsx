import { initials, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, Card, CardContent } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { DueDate, TaskPriorityIcon, TaskStatusBadge } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'List' }

/** Flat table view of a project's tasks — the same data as the board, sorted. */
export default async function ListPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: tasks }, { data: org }] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        `id, title, status, priority, due_date, task_number, updated_at,
         assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url)`,
      )
      .eq('project_id', params.projectId)
      .order('status')
      .order('position'),
    supabase.from('organizations').select('timezone').eq('id', auth.orgId).maybeSingle(),
  ])

  const today = todayIn(org?.timezone ?? 'UTC')
  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Tasks in this project</caption>
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">#</th>
                <th scope="col" className="px-4 py-3 font-medium">Task</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Priority</th>
                <th scope="col" className="px-4 py-3 font-medium">Assignee</th>
                <th scope="col" className="px-4 py-3 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {(tasks ?? []).map((task) => {
                const assignee = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee
                return (
                  <tr key={task.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {task.task_number}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`${base}/tasks/${task.id}`} className="font-medium hover:underline">
                        {task.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <TaskStatusBadge status={task.status as never} />
                    </td>
                    <td className="px-4 py-3">
                      <TaskPriorityIcon priority={task.priority as never} showLabel />
                    </td>
                    <td className="px-4 py-3">
                      {assignee ? (
                        <span className="inline-flex items-center gap-2">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px]">
                              {initials(assignee.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          {assignee.full_name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <DueDate
                        dueDate={task.due_date}
                        today={today}
                        isClosed={task.status === 'done' || task.status === 'cancelled'}
                      />
                      {!task.due_date ? <span className="text-muted-foreground">—</span> : null}
                    </td>
                  </tr>
                )
              })}
              {!tasks?.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No tasks yet. Add one from the board.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
