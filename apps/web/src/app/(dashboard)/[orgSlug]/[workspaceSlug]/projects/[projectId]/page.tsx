import { redirect } from 'next/navigation'

/**
 * A project's root URL has no view of its own.
 *
 * Opening a project lands on its list, which is the first tab in the view
 * switcher. This exists so a link written without a view segment — from an
 * email, an old bookmark, a paste — reaches something rather than 404ing.
 */
export default function ProjectIndexPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  redirect(`/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}/list`)
}
