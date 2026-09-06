import { publicIdToString } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import { FolderKanban } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePortal } from '@/lib/auth/portal'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Shared projects' }

/**
 * Projects shared with this external user.
 *
 * Driven entirely by `portal_project_access` — the allowlist (§18 rule 6).
 * There is no implicit access through workspace or organization membership, so
 * an empty list here is the correct outcome, not an error.
 */
export default async function PortalHomePage({ params }: { params: { orgSlug: string } }) {
  const portal = await requirePortal(params.orgSlug)
  const supabase = createClient()

  const { data: access } = await supabase
    .from('portal_project_access')
    .select(
      'can_comment, can_upload, project:projects!portal_project_access_project_id_fkey(id, public_id, name, description, status)',
    )
    .eq('portal_user_id', portal.portalUserId)

  const projects = (access ?? [])
    .map((row) => {
      // PostgREST returns a to-one embed as an object; the generated types
      // allow an array, so normalise rather than casting blindly.
      const project = Array.isArray(row.project) ? row.project[0] : row.project
      return project ? { ...project, canComment: row.can_comment } : null
    })
    .filter((project): project is NonNullable<typeof project> => project !== null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-head font-semibold tracking-tight">Shared with you</h1>
        <p className="pt-1 text-base text-muted-foreground">
          {projects.length === 0
            ? 'Nothing has been shared with you yet.'
            : `${projects.length} project${projects.length === 1 ? '' : 's'} from ${portal.orgName}.`}
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
          <FolderKanban className="h-6 w-6 text-faint" aria-hidden />
          <p className="pt-3 text-base text-muted-foreground">No shared projects.</p>
          <p className="pt-1 text-nav text-faint">
            Someone at {portal.orgName} needs to grant you access.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/portal/${params.orgSlug}/projects/${publicIdToString(project.public_id)}`}
                className="block rounded-lg border border-border bg-surface p-4 shadow-card transition-colors hover:border-input"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {project.name}
                  </span>
                  <Badge variant={project.status === 'active' ? 'success' : 'secondary'} shape="meta">
                    {project.status.replace('_', ' ')}
                  </Badge>
                </div>
                {project.description ? (
                  <p className="line-clamp-2 pt-2 text-base text-muted-foreground">
                    {project.description}
                  </p>
                ) : null}
                <p className="label-meta pt-3 text-faint">
                  {project.canComment ? 'You can comment' : 'Read only'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
