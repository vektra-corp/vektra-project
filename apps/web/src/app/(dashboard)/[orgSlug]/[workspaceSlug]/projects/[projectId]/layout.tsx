import { Badge } from '@pm/ui'
import { differenceInCalendarDays } from 'date-fns'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
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
  const supabase = createClient()

  const { data: project } = await supabase
    .from('projects')
    .select(
      'id, name, status, priority, end_date, workspace:workspaces!projects_workspace_id_fkey(name)',
    )
    .eq('id', params.projectId)
    .maybeSingle()

  // RLS returns nothing for a project in another tenant, which is the same
  // observable outcome as one that does not exist. That is deliberate.
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
            href: `/${params.orgSlug}/${params.workspaceSlug}/projects/${project.id}/board`,
          },
        ]}
        meta={
          <Badge
            variant={project.status === 'active' ? 'success' : 'secondary'}
            shape="meta"
            className="ms-1"
          >
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
