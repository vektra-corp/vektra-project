import { can, canManageProject } from '@pm/auth/rbac'
import { resolveProjectSettings } from '@pm/shared/constants'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CustomFieldInputs } from '@/components/custom-fields/custom-field-inputs'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { loadProjectAccess } from '@/lib/auth/project-access'
import { loadCustomFields } from '@/lib/custom-fields'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'
import { ProjectArchive } from './project-archive'
import { ProjectGovernance } from './project-governance'
import { ProjectLabels } from './project-labels'
import { ProjectNotifications } from './project-notifications'
import { ProjectSettingsForm } from './project-settings-form'
import { ProjectStatuses, type StatusColumn } from './project-statuses'

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
    .select('id, key, name, description, status, priority, start_date, end_date, settings')
    .eq('id', resolved.id)
    .eq('organization_id', auth.orgId)
    .maybeSingle()

  if (!project) notFound()

  // This project's own labels plus the org-wide ones, matching what the task
  // panel's picker offers (§6.2) — otherwise settings would list a different
  // set from the one people actually choose between.
  const { data: labels } = await supabase
    .from('labels')
    .select('id, name, color, project_id')
    .eq('organization_id', auth.orgId)
    .or(`project_id.is.null,project_id.eq.${project.id}`)
    .order('name')

  // The board's columns are this project's statuses (business rule 3), plus a
  // count so nobody deletes a status without seeing what is sitting in it.
  const [{ data: columns }, { data: columnTaskCounts }, { data: notificationPrefs }] =
    await Promise.all([
      supabase
        .from('kanban_columns')
        .select(
          'id, name, status, position, board:kanban_boards!kanban_columns_board_id_fkey(project_id)',
        )
        .eq('board.project_id', project.id)
        .order('position'),
      supabase.from('tasks').select('kanban_column_id').eq('project_id', project.id),
      supabase
        .from('project_notification_preferences')
        .select('muted, preferences')
        .eq('project_id', project.id)
        .eq('user_id', auth.userId)
        .maybeSingle(),
    ])

  const countByColumn = new Map<string, number>()
  for (const row of columnTaskCounts ?? []) {
    if (!row.kanban_column_id) continue
    countByColumn.set(row.kanban_column_id, (countByColumn.get(row.kanban_column_id) ?? 0) + 1)
  }

  const statusColumns: StatusColumn[] = (columns ?? [])
    // The embed filters by the parent board, but PostgREST still returns rows
    // whose board did not match as `board: null`; drop those rather than
    // showing another project's columns.
    .filter((column) => column.board)
    .map((column) => ({
      id: column.id,
      name: column.name,
      status: column.status,
      position: column.position,
      taskCount: countByColumn.get(column.id) ?? 0,
    }))

  const access = await loadProjectAccess(auth, project.id)
  const custom = await loadCustomFields(supabase, auth.orgId, 'project', project.id)
  const canEdit = can(auth, 'projects', 'update')
  const canGovern = canManageProject(access)
  const settings = resolveProjectSettings(project.settings)

  return (
    <PageBody className="pt-4">
      <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
        <ProjectSettingsForm
          scope={params}
          project={project}
          publicId={resolved.publicId}
          canEdit={canEdit}
        />

        <ProjectGovernance scope={params} settings={settings} canEdit={canGovern} />

        <ProjectStatuses scope={params} columns={statusColumns} canEdit={canGovern} />

        <ProjectNotifications
          scope={params}
          projectName={project.name}
          initial={{
            muted: notificationPrefs?.muted ?? false,
            preferences:
              (notificationPrefs?.preferences as Record<
                string,
                { email?: boolean; in_app?: boolean }
              >) ?? {},
          }}
        />

        <ProjectLabels
          scope={params}
          canEdit={canEdit}
          labels={(labels ?? []).map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
            projectId: label.project_id,
          }))}
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

        <ProjectArchive
          scope={params}
          projectName={project.name}
          archived={project.status === 'archived'}
          canEdit={canEdit}
        />
      </div>
    </PageBody>
  )
}
