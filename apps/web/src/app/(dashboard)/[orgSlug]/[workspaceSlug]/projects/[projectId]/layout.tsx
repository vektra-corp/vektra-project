import { Badge } from '@pm/ui'
import { differenceInCalendarDays } from 'date-fns'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

/**
 * Project shell: the section header.
 *
 * Fetching the project here rather than in each view means the views share one
 * round trip and a missing project 404s once instead of per view. The view
 * switcher lives in each view's own toolbar, beside that view's controls.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  await requireAuthPage(params.orgSlug)

  // params.projectId is the 16-digit public id; resolveProject turns it into the
  // row, or into a 404 for an id that is malformed, deleted or another tenant's.
  const resolved = await resolveProject(params.projectId)
  if (!resolved) notFound()

  const supabase = createClient()
  const { data: project } = await supabase
    .from('projects')
    .select(
      'name, key, status, priority, end_date, workspace:workspaces!projects_workspace_id_fkey(name)',
    )
    .eq('id', resolved.id)
    .maybeSingle()

  if (!project) notFound()

  const workspace = Array.isArray(project.workspace) ? project.workspace[0] : project.workspace

  // Days remaining is a plain calendar-day difference, so a project ending today
  // reads as "today" rather than as a fractional day.
  const daysLeft = project.end_date
    ? differenceInCalendarDays(new Date(project.end_date), new Date())
    : null

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[
          {
            label: workspace?.name ?? 'Projects',
            href: `/${params.orgSlug}/${params.workspaceSlug}/projects`,
          },
          {
            label: project.name,
            href: `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}/board`,
          },
        ]}
        meta={
          <Badge
            variant={project.status === 'active' ? 'success' : 'secondary'}
            shape="meta"
            className="ms-1"
          >
            <span className="pe-1 opacity-70">{project.key}</span>
            {project.status.replace('_', ' ')}
            {daysLeft !== null ? (
              <>
                <span className="px-0.5 opacity-50">·</span>
                {daysLeft >= 0 ? `${daysLeft}d left` : `${Math.abs(daysLeft)}d over`}
              </>
            ) : null}
          </Badge>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </>
  )
}
