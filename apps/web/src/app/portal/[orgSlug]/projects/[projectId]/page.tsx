import { todayIn } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { RichTextView } from '@/components/editor/rich-text'
import { DueDate, TaskStatusBadge } from '@/components/tasks/task-badges'
import { requirePortal } from '@/lib/auth/portal'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'
import { PortalComments, type PortalCommentRow } from './portal-comments'

export const metadata: Metadata = { title: 'Project' }

/**
 * One shared project, as an external user sees it.
 *
 * Read-only apart from comments. RLS is what actually enforces this — the
 * portal policies expose only tasks in allowlisted projects and only
 * non-internal comments — so this page never has to filter for safety, only
 * for presentation.
 */
export default async function PortalProjectPage({
  params,
}: {
  params: { orgSlug: string; projectId: string }
}) {
  const portal = await requirePortal(params.orgSlug)

  // The URL carries the 16-digit public id. A portal user can only resolve a
  // project the portal RLS policies already let them see, so this is not a way
  // to confirm that some other tenant's id exists.
  const resolved = await resolveProject(params.projectId)
  if (!resolved) notFound()

  const locale = await getLocale()
  const supabase = createClient()

  const { data: access } = await supabase
    .from('portal_project_access')
    .select(
      'can_comment, project:projects!portal_project_access_project_id_fkey(id, name, description, status, end_date)',
    )
    .eq('portal_user_id', portal.portalUserId)
    .eq('project_id', resolved.id)
    .maybeSingle()

  // No allowlist row means no access. Same observable outcome as a project that
  // does not exist, which is deliberate (§18 rule 6).
  if (!access) notFound()

  const project = Array.isArray(access.project) ? access.project[0] : access.project
  if (!project) notFound()

  const [{ data: tasks }, { data: documents }] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, due_date, task_number, description')
      .eq('project_id', resolved.id)
      .order('position')
      .limit(100),
    supabase
      .from('documents')
      .select('id, title, updated_at')
      .eq('project_id', resolved.id)
      .eq('status', 'published')
      .order('updated_at', { ascending: false }),
  ])

  const taskIds = (tasks ?? []).map((task) => task.id)

  const { data: comments } = taskIds.length
    ? await supabase
        .from('comments')
        .select(
          'id, task_id, body, created_at, author:profiles!comments_author_id_fkey(full_name, avatar_url)',
        )
        .in('task_id', taskIds)
        .order('created_at')
    : { data: [] as never[] }

  const byTask = new Map<string, PortalCommentRow[]>()
  for (const comment of comments ?? []) {
    const author = Array.isArray(comment.author) ? comment.author[0] : comment.author
    const list = byTask.get(comment.task_id!) ?? []
    list.push({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      authorName: author?.full_name ?? 'Unknown',
      authorAvatar: author?.avatar_url ?? null,
    })
    byTask.set(comment.task_id!, list)
  }

  const today = todayIn('UTC')

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/portal/${params.orgSlug}`}
          className="label-meta text-faint transition-colors hover:text-muted-foreground"
        >
          &larr; All shared projects
        </Link>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <h1 className="text-head font-semibold tracking-tight">{project.name}</h1>
          <Badge variant={project.status === 'active' ? 'success' : 'secondary'} shape="meta">
            {project.status.replace('_', ' ')}
          </Badge>
        </div>
        {project.description ? (
          <p className="pt-2 text-base text-muted-foreground">{project.description}</p>
        ) : null}
      </div>

      {documents?.length ? (
        <section className="space-y-2">
          <h2 className="label-meta text-faint">Published documents</h2>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface">
            {documents.map((document) => (
              <li key={document.id} className="px-4 py-2.5 text-base">
                {document.title}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="label-meta text-faint">Work items</h2>

        {!tasks?.length ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-base text-faint">
            Nothing to show yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
                  <span className="label-meta text-faint">#{task.task_number}</span>
                  <span className="min-w-0 flex-1 text-base font-medium">{task.title}</span>
                  <DueDate
                    dueDate={task.due_date}
                    today={today}
                    isClosed={task.status === 'done' || task.status === 'cancelled'}
                  />
                  <TaskStatusBadge status={task.status as never} />
                </div>

                <div className="space-y-4 px-4 py-3">
                  {(task.description as { content?: unknown[] } | null)?.content?.length ? (
                    <RichTextView doc={task.description} />
                  ) : null}

                  <PortalComments
                    orgSlug={params.orgSlug}
                    projectId={params.projectId}
                    taskId={task.id}
                    comments={byTask.get(task.id) ?? []}
                    locale={locale}
                    canComment={access.can_comment}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
