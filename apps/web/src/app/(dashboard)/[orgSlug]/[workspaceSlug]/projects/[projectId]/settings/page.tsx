import { can } from '@pm/auth/rbac'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CustomFieldInputs } from '@/components/custom-fields/custom-field-inputs'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { loadCustomFields } from '@/lib/custom-fields'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'
import { ProjectSettingsForm } from './project-settings-form'

export const metadata: Metadata = { title: 'Project settings' }

/**
 * Project settings (§4).
 *
 * Also the home for project-level custom fields (§6.7) — a definition with
 * `entity_type = 'project'` had nowhere to be filled in before this page
 * existed, so those fields could be created and never used.
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)

  const resolved = await resolveProject(params.projectId)
  if (!resolved) notFound()

  const supabase = createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, key, name, description, status, priority, start_date, end_date')
    .eq('id', resolved.id)
    .eq('organization_id', auth.orgId)
    .maybeSingle()

  if (!project) notFound()

  const custom = await loadCustomFields(supabase, auth.orgId, 'project', project.id)
  const canEdit = can(auth, 'projects', 'update')

  return (
    <PageBody className="pt-4">
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
        <ProjectSettingsForm
          scope={params}
          project={project}
          publicId={resolved.publicId}
          canEdit={canEdit}
        />

        {custom.fields.length > 0 ? (
          <section className="rounded-lg border border-border bg-surface shadow-card">
            <div className="border-b border-border-subtle px-5 py-4">
              <h2 className="text-ui font-semibold">Custom fields</h2>
              <p className="pt-1 text-base text-muted-foreground">
                Defined for projects in organization settings.
              </p>
            </div>
            <div className="px-5 py-5">
              <CustomFieldInputs
                orgSlug={params.orgSlug}
                entityType="project"
                entityId={project.id}
                fields={custom.fields}
                values={custom.values}
                canEdit={canEdit}
              />
            </div>
          </section>
        ) : null}
      </div>
    </PageBody>
  )
}
