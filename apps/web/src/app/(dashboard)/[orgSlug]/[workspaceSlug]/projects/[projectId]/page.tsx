import { redirect } from 'next/navigation'

/**
 * A project's root URL has no view of its own.
 *
 * The design lands you on the overview when you open a project, so that is what
 * a bare project link resolves to. This exists so a link written without a view
 * segment — from an email, an old bookmark, a paste — reaches something rather
 * than 404ing.
 */
export default function ProjectIndexPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  redirect(
    `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}/overview`,
  )
}
