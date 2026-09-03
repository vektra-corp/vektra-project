import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import { FolderPlus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Projects' }

export default async function ProjectsPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
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
    .select('id, name, description, status, priority, start_date, end_date, updated_at')
    .eq('workspace_id', workspace.id)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })

  // One grouped count instead of a query per card.
  const ids = (projects ?? []).map((p) => p.id)
  const { data: taskRows } = ids.length
    ? await supabase.from('tasks').select('project_id, status').in('project_id', ids)
    : { data: [] }

  const stats = new Map<string, { total: number; done: number }>()
  for (const row of taskRows ?? []) {
    const entry = stats.get(row.project_id) ?? { total: 0, done: 0 }
    entry.total += 1
    if (row.status === 'done' || row.status === 'cancelled') entry.done += 1
    stats.set(row.project_id, entry)
  }

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{workspace.name}</p>
        </div>
        <Button asChild>
          <Link href={`${base}/new`}>{t('create')}</Link>
        </Button>
      </div>

      {projects && projects.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const stat = stats.get(project.id) ?? { total: 0, done: 0 }
            const percent = stat.total === 0 ? 0 : Math.round((stat.done / stat.total) * 100)

            return (
              <Link key={project.id} href={`${base}/${project.id}/board`} className="group">
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base leading-tight">{project.name}</CardTitle>
                      {project.priority ? (
                        <Badge variant="outline" className="shrink-0 capitalize">
                          {project.priority}
                        </Badge>
                      ) : null}
                    </div>
                    {project.description ? (
                      <CardDescription className="line-clamp-2">
                        {project.description}
                      </CardDescription>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{t('task_count', { count: stat.total })}</span>
                      <span>{t('completion', { percent: `${percent}%` })}</span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${project.name} progress`}
                    >
                      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FolderPlus className="h-8 w-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">{t('empty_title')}</p>
              <p className="text-sm text-muted-foreground">{t('empty_body')}</p>
            </div>
            <Button asChild>
              <Link href={`${base}/new`}>{t('create')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
