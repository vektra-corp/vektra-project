import { projectKey } from '@pm/shared/utils'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Widget, WidgetEmpty } from '@/components/dashboard/widget'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { TaskPriorityIcon, TaskStatusBadge } from '@/components/tasks/task-badges'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { SearchInput } from './search-input'

export const metadata: Metadata = { title: 'Search' }

/**
 * Cross-project search.
 *
 * Uses `ilike` against titles, which the existing indexes serve well enough at
 * this scale; the dedicated search engine in §22.5's phase 3 replaces it when
 * full-text across descriptions and documents is needed. RLS scopes the results,
 * so this can never surface another tenant's work.
 */
export default async function SearchPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string }
  searchParams: { q?: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const query = (searchParams.q ?? '').trim()
  const supabase = createClient()

  // Escape the LIKE wildcards so a literal % does not match everything.
  const pattern = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`

  const [{ data: tasks }, { data: projects }] = query
    ? await Promise.all([
        supabase
          .from('tasks')
          .select(
            `id, title, status, priority, task_number, project_id,
             project:projects!tasks_project_id_fkey(
               name, workspace:workspaces!projects_workspace_id_fkey(slug)
             )`,
          )
          .eq('organization_id', auth.orgId)
          .ilike('title', pattern)
          .limit(20),
        supabase
          .from('projects')
          .select('id, name, status, workspace:workspaces!projects_workspace_id_fkey(slug)')
          .eq('organization_id', auth.orgId)
          .ilike('name', pattern)
          .limit(10),
      ])
    : [{ data: [] }, { data: [] }]

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Search' }]} />

      <PageBody className="pt-2">
        <div className="mx-auto max-w-2xl space-y-4">
          <SearchInput initialQuery={query} />

          {!query ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              Start typing to search tasks and projects.
            </p>
          ) : (
            <>
              <Widget title={`Tasks (${tasks?.length ?? 0})`}>
                {!tasks?.length ? (
                  <WidgetEmpty>No matching tasks.</WidgetEmpty>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {tasks.map((task) => {
                      const project = Array.isArray(task.project) ? task.project[0] : task.project
                      const workspace = project
                        ? Array.isArray(project.workspace)
                          ? project.workspace[0]
                          : project.workspace
                        : null
                      const href = workspace
                        ? `/${params.orgSlug}/${workspace.slug}/projects/${task.project_id}/tasks/${task.id}`
                        : null

                      return (
                        <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="label-meta shrink-0 text-faint">
                            {projectKey(project?.name ?? 'Task')}-{task.task_number}
                          </span>
                          {href ? (
                            <Link
                              href={href}
                              className="min-w-0 flex-1 truncate text-[13px] transition-colors hover:text-primary"
                            >
                              {task.title}
                            </Link>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
                          )}
                          <TaskPriorityIcon priority={task.priority as never} />
                          <TaskStatusBadge status={task.status as never} />
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Widget>

              <Widget title={`Projects (${projects?.length ?? 0})`}>
                {!projects?.length ? (
                  <WidgetEmpty>No matching projects.</WidgetEmpty>
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {projects.map((project) => {
                      const workspace = Array.isArray(project.workspace)
                        ? project.workspace[0]
                        : project.workspace
                      const href = workspace
                        ? `/${params.orgSlug}/${workspace.slug}/projects/${project.id}/board`
                        : null

                      return (
                        <li key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                          {href ? (
                            <Link
                              href={href}
                              className="min-w-0 flex-1 truncate text-[13px] transition-colors hover:text-primary"
                            >
                              {project.name}
                            </Link>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-[13px]">
                              {project.name}
                            </span>
                          )}
                          <span className="label-meta shrink-0 capitalize text-faint">
                            {project.status.replace('_', ' ')}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Widget>
            </>
          )}
        </div>
      </PageBody>
    </>
  )
}
