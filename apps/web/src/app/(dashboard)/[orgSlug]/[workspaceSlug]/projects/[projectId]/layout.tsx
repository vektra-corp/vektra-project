import { Badge } from '@pm/ui'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { ProjectTabs } from '@/components/projects/project-tabs'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Project shell: header plus the view switcher.
 *
 * Fetching the project here rather than in each view means the four tabs share
 * one round trip and a missing project 404s once instead of per view.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, description, status, priority')
    .eq('id', params.projectId)
    .maybeSingle()

  // RLS returns nothing for a project in another tenant, which is the same
  // observable outcome as one that does not exist. That is deliberate.
  if (!project) notFound()

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${project.id}`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <Badge variant="outline" className="capitalize">
            {project.status.replace('_', ' ')}
          </Badge>
          {project.priority ? (
            <Badge variant="secondary" className="capitalize">
              {project.priority}
            </Badge>
          ) : null}
        </div>
        {project.description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{project.description}</p>
        ) : null}
        <ProjectTabs base={base} />
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
