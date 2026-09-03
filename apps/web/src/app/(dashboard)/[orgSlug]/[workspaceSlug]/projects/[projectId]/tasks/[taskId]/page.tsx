import { can } from '@pm/auth/rbac'
import { TASK_STATUSES, PRIORITIES } from '@pm/shared/constants'
import { formatRelativeTime, initials, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Card, CardContent } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { AttachmentList, type AttachmentRow } from '@/components/attachments/attachment-list'
import { CommentThread, type CommentRow } from '@/components/comments/comment-thread'
import { SubtaskList, type SubtaskRow } from '@/components/tasks/subtask-list'
import { DueDate, TaskStatusBadge } from '@/components/tasks/task-badges'
import { TaskFields } from '@/components/tasks/task-fields'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

interface Member {
  id: string
  full_name: string
  avatar_url: string | null
}

export const metadata: Metadata = { title: 'Task' }

export default async function TaskDetailPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string; taskId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const locale = await getLocale()
  const supabase = createClient()

  const { data: task } = await supabase
    .from('tasks')
    .select(
      `id, title, description, status, priority, due_date, start_date, estimated_hours,
       actual_hours, task_number, is_milestone, started_at, completed_at, created_at, updated_at,
       assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url),
       assigner:profiles!tasks_assigner_id_fkey(id, full_name, avatar_url)`,
    )
    .eq('id', params.taskId)
    .maybeSingle()

  if (!task) notFound()

  const [{ data: subtasks }, { data: comments }, { data: members }, { data: attachments }, { data: org }] =
    await Promise.all([
      supabase
        .from('subtasks')
        .select(
          'id, title, status, position, assignee:profiles!subtasks_assignee_id_fkey(id, full_name, avatar_url)',
        )
        .eq('task_id', params.taskId)
        .order('position'),
      supabase
        .from('comments')
        .select(
          'id, body, is_internal, is_edited, created_at, author:profiles!comments_author_id_fkey(id, full_name, avatar_url)',
        )
        .eq('task_id', params.taskId)
        .order('created_at'),
      supabase
        .from('org_members')
        .select('profile:profiles!inner(id, full_name, avatar_url)')
        .eq('organization_id', auth.orgId),
      supabase
        .from('attachments')
        .select('id, file_name, file_size, mime_type, created_at, uploaded_by')
        .eq('task_id', params.taskId)
        .order('created_at', { ascending: false }),
      supabase.from('organizations').select('timezone').eq('id', auth.orgId).maybeSingle(),
    ])

  // PostgREST returns to-one embeds as objects; the generated types permit an
  // array, so normalise before use.
  const one = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value

  const assignee = one(task.assignee)
  const assigner = one(task.assigner)
  const canEdit = can(auth, 'tasks', 'update')

  const assignableMembers = (members ?? [])
    .flatMap((row) => {
      const profile = one(row.profile) as Member | null
      return profile ? [profile] : []
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  const projectBase = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <Link
            href={`${projectBase}/board`}
            className="text-xs text-muted-foreground hover:underline"
          >
            &larr; Back to board
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="tabular-nums text-sm text-muted-foreground">#{task.task_number}</span>
            <h1 className="text-xl font-semibold">{task.title}</h1>
            <TaskStatusBadge status={task.status as never} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Created {formatRelativeTime(task.created_at, locale)}
            {assigner ? ` · assigned by ${assigner.full_name}` : ''}
          </p>
        </div>

        <Card>
          <CardContent className="space-y-6 pt-6">
            <SubtaskList
              scope={params}
              taskId={task.id}
              canEdit={canEdit}
              subtasks={(subtasks ?? []).map((subtask) => ({
                id: subtask.id,
                title: subtask.title,
                status: subtask.status,
                assignee: one(subtask.assignee),
              })) as SubtaskRow[]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <AttachmentList
              scope={params}
              taskId={task.id}
              locale={locale}
              canEdit={canEdit}
              currentUserId={auth.userId}
              attachments={(attachments ?? []) as AttachmentRow[]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <CommentThread
              scope={params}
              taskId={task.id}
              locale={locale}
              canComment
              comments={(comments ?? []).map((comment) => ({
                id: comment.id,
                body: comment.body,
                is_internal: comment.is_internal,
                is_edited: comment.is_edited,
                created_at: comment.created_at,
                author: one(comment.author),
              })) as CommentRow[]}
            />
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <TaskFields
              scope={params}
              taskId={task.id}
              canEdit={canEdit}
              statuses={TASK_STATUSES}
              priorities={PRIORITIES}
              members={assignableMembers}
              value={{
                status: task.status,
                priority: task.priority,
                assignee_id: assignee?.id ?? '',
                due_date: task.due_date ?? '',
                start_date: task.start_date ?? '',
                estimated_hours: task.estimated_hours,
              }}
            />

            <dl className="space-y-3 border-t pt-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Assignee</dt>
                <dd className="flex items-center gap-2">
                  {assignee ? (
                    <>
                      <Avatar className="h-5 w-5">
                        {assignee.avatar_url ? <AvatarImage src={assignee.avatar_url} alt="" /> : null}
                        <AvatarFallback className="text-[9px]">
                          {initials(assignee.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span>{assignee.full_name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </dd>
              </div>

              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Due</dt>
                <dd>
                  <DueDate
                    dueDate={task.due_date}
                    today={todayIn(org?.timezone ?? 'UTC')}
                    isClosed={task.status === 'done' || task.status === 'cancelled'}
                  />
                  {!task.due_date ? <span className="text-muted-foreground">—</span> : null}
                </dd>
              </div>

              {/* started_at and completed_at are written by a database trigger
                  when the status changes, never by the client (§19.7). */}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Started</dt>
                <dd className="tabular-nums">
                  {task.started_at ? formatRelativeTime(task.started_at, locale) : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Completed</dt>
                <dd className="tabular-nums">
                  {task.completed_at ? formatRelativeTime(task.completed_at, locale) : '—'}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}
