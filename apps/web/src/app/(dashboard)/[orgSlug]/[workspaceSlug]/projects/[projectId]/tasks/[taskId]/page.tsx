import { can } from '@pm/auth/rbac'
import {
  PRIORITIES,
  TASK_STATUSES,
  parseFieldOptions,
  type CustomFieldDefinition,
} from '@pm/shared/constants'
import { formatRelativeTime, initials, todayIn } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Button } from '@pm/ui'
import { Columns3, X } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { AttachmentList, type AttachmentRow } from '@/components/attachments/attachment-list'
import { CommentThread, type CommentRow } from '@/components/comments/comment-thread'
import {
  CustomFieldInputs,
  type CustomValue,
} from '@/components/custom-fields/custom-field-inputs'
import { SubtaskList, type SubtaskRow } from '@/components/tasks/subtask-list'
import { DueDate, TaskStatusBadge } from '@/components/tasks/task-badges'
import { TaskDescription } from '@/components/tasks/task-description'
import { TaskFields } from '@/components/tasks/task-fields'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject, resolveTask } from '@/lib/route-ids'
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

  // Both ids in the URL are 16-digit public ids. Resolving them together costs
  // one round trip each and gives the page the uuids every query below needs,
  // plus the project key the identity bar reads.
  const [project, taskRef] = await Promise.all([
    resolveProject(params.projectId),
    resolveTask(params.taskId),
  ])
  // A task addressed under the wrong project is a 404, not a redirect: the URL
  // asserts a relationship that does not hold.
  if (!project || !taskRef || taskRef.projectId !== project.id) notFound()

  const locale = await getLocale()
  const supabase = createClient()

  const { data: task } = await supabase
    .from('tasks')
    .select(
      `id, public_id, title, description, status, priority, due_date, start_date, estimated_hours,
       actual_hours, task_number, is_milestone, started_at, completed_at, created_at, updated_at,
       assignee:profiles!tasks_assignee_id_fkey(id, full_name, avatar_url),
       assigner:profiles!tasks_assigner_id_fkey(id, full_name, avatar_url)`,
    )
    .eq('id', taskRef.id)
    .maybeSingle()

  if (!task) notFound()

  const [
    { data: subtasks },
    { data: comments },
    { data: members },
    { data: attachments },
    { data: customFields },
    { data: customValues },
  ] = await Promise.all([
      supabase
        .from('subtasks')
        .select(
          'id, title, status, position, assignee:profiles!subtasks_assignee_id_fkey(id, full_name, avatar_url)',
        )
        .eq('task_id', taskRef.id)
        .order('position'),
      supabase
        .from('comments')
        .select(
          'id, body, is_internal, is_edited, created_at, author:profiles!comments_author_id_fkey(id, full_name, avatar_url)',
        )
        .eq('task_id', taskRef.id)
        .order('created_at'),
      supabase
        .from('org_members')
        .select('profile:profiles!inner(id, full_name, avatar_url)')
        .eq('organization_id', auth.orgId),
      supabase
        .from('attachments')
        .select('id, file_name, file_size, mime_type, created_at, uploaded_by')
        .eq('task_id', taskRef.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('custom_fields')
        .select('id, entity_type, name, field_type, options, is_required, position')
        .eq('organization_id', auth.orgId)
        .eq('entity_type', 'task')
        .order('position'),
      supabase
        .from('custom_field_values')
        .select('custom_field_id, value')
        .eq('entity_id', taskRef.id),
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
  const projectName = project.name
  const prefix = project.key

  const fieldDefinitions: CustomFieldDefinition[] = (customFields ?? []).map((field) => ({
    id: field.id,
    entity_type: 'task',
    name: field.name,
    field_type: field.field_type as CustomFieldDefinition['field_type'],
    options: parseFieldOptions(field.options),
    is_required: field.is_required,
    position: field.position,
  }))

  // The value column is jsonb, so a stored value arrives as whatever JSON type
  // its field wrote; the inputs coerce per field_type from here.
  const fieldValues: Record<string, CustomValue> = {}
  for (const row of customValues ?? []) {
    fieldValues[row.custom_field_id] = (row.value ?? null) as CustomValue
  }

  const closed = task.status === 'done' || task.status === 'cancelled'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
       * The design presents a task as a modal over the board. Here it is a
       * page, because the app gives every task its own URL and a modal cannot
       * be linked to, refreshed or opened in a tab. The modal's *layout* is
       * what carries over: an identity bar, then a two-pane split with the
       * work on the left and the properties on the right.
       */}
      <div className="border-border bg-surface flex shrink-0 flex-wrap items-center gap-2.5 border-b px-4 py-3">
        <span className="label-id text-faint tracking-[0.06em]">
          {prefix}-{task.task_number}
        </span>
        <span className="bg-input h-3 w-px" aria-hidden />
        <Link
          href={`${projectBase}/board`}
          className="text-faint hover:text-foreground text-nav transition-colors"
        >
          {projectName}
        </Link>
        <TaskStatusBadge status={task.status as never} />

        <span className="ms-auto flex items-center gap-1.5">
          <Button asChild variant="subtle" size="sm">
            <Link href={`${projectBase}/tasks/${taskRef.publicId}/board`}>
              <Columns3 className="h-3.5 w-3.5" aria-hidden />
              Subtask board
            </Link>
          </Button>
          <Button asChild variant="subtle" size="icon-sm" aria-label="Back to board">
            <Link href={`${projectBase}/board`}>
              <X className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </Button>
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="scrollbar-slim flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            {task.title}
          </h1>

          <section className="flex flex-col gap-2">
            <h2 className="label-meta text-subtle">Description</h2>
            <TaskDescription
              scope={params}
              taskId={task.id}
              description={task.description}
              canEdit={canEdit}
            />
          </section>

          {fieldDefinitions.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="label-meta text-subtle">Custom fields</h2>
              <CustomFieldInputs
                orgSlug={params.orgSlug}
                entityType="task"
                entityId={task.id}
                fields={fieldDefinitions}
                values={fieldValues}
                canEdit={canEdit}
              />
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <SubtaskList
              scope={params}
              taskId={task.id}
              canEdit={canEdit}
              subtasks={
                (subtasks ?? []).map((subtask) => ({
                  id: subtask.id,
                  title: subtask.title,
                  status: subtask.status,
                  assignee: one(subtask.assignee),
                })) as SubtaskRow[]
              }
            />
          </section>

          <section className="flex flex-col gap-2">
            <AttachmentList
              scope={params}
              taskId={task.id}
              locale={locale}
              canEdit={canEdit}
              currentUserId={auth.userId}
              attachments={(attachments ?? []) as AttachmentRow[]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="label-meta text-subtle">Activity</h2>
            <CommentThread
              scope={params}
              taskId={task.id}
              locale={locale}
              canComment
              comments={
                (comments ?? []).map((comment) => ({
                  id: comment.id,
                  body: comment.body,
                  is_internal: comment.is_internal,
                  is_edited: comment.is_edited,
                  created_at: comment.created_at,
                  author: one(comment.author),
                })) as CommentRow[]
              }
            />
          </section>
        </div>

        <aside className="border-border scrollbar-slim w-full shrink-0 overflow-y-auto border-s px-5 py-5 lg:w-[340px]">
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

          <dl className="border-border mt-5 space-y-3 border-t pt-5 text-ui">
            <div className="flex items-center justify-between gap-2">
              <dt className="label-meta text-subtle">Assigned by</dt>
              <dd className="flex items-center gap-2">
                {assigner ? (
                  <>
                    <Avatar className="h-5 w-5">
                      {assigner.avatar_url ? (
                        <AvatarImage src={assigner.avatar_url} alt="" />
                      ) : null}
                      <AvatarFallback className="bg-chip text-[9px]">
                        {initials(assigner.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span>{assigner.full_name}</span>
                  </>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="label-meta text-subtle">Estimate</dt>
              <dd>
                {task.estimated_hours ? (
                  <span className="bg-chip label-id text-muted-foreground rounded-sm px-2 py-1">
                    {task.estimated_hours} PTS
                  </span>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="label-meta text-subtle">Due</dt>
              <dd>
                <DueDate
                  dueDate={task.due_date}
                  today={todayIn(auth.orgTimezone)}
                  isClosed={closed}
                />
                {!task.due_date ? <span className="text-faint">—</span> : null}
              </dd>
            </div>

            {/* started_at and completed_at are written by a database trigger
              when the status changes, never by the client (§19.7). */}
            <div className="flex items-center justify-between gap-2">
              <dt className="label-meta text-subtle">Started</dt>
              <dd className="tabular-nums">
                {task.started_at ? formatRelativeTime(task.started_at, locale) : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="label-meta text-subtle">Completed</dt>
              <dd className="tabular-nums">
                {task.completed_at ? formatRelativeTime(task.completed_at, locale) : '—'}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>
  )
}
