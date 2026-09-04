'use client'

import { PRIORITIES, PROJECT_STATUSES } from '@pm/shared/constants'
import { Input, Textarea } from '@pm/ui'
import { Field, SelectField, SettingsForm } from '@/components/settings/settings-form'
import { updateProject } from '../../actions'

const titleCase = (value: string) =>
  value.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase())

/** Editing surface for a project's own fields. */
export function ProjectSettingsForm({
  scope,
  project,
  canEdit,
}: {
  scope: { orgSlug: string; workspaceSlug: string; projectId: string }
  project: {
    name: string
    description: string | null
    status: string
    priority: string | null
    start_date: string | null
    end_date: string | null
  }
  canEdit: boolean
}) {
  return (
    <fieldset disabled={!canEdit} className="contents">
      <SettingsForm
        action={updateProject.bind(null, scope.orgSlug, scope.workspaceSlug, scope.projectId)}
        title="Project"
        description={
          canEdit
            ? 'Name, status and dates. Dates drive the timeline view.'
            : 'You do not have permission to change these.'
        }
      >
        <Field id="project-name" label="Name">
          <Input id="project-name" name="name" defaultValue={project.name} required maxLength={120} />
        </Field>

        <Field id="project-description" label="Description">
          <Textarea
            id="project-description"
            name="description"
            rows={3}
            defaultValue={project.description ?? ''}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="project-status" label="Status">
            <SelectField
              id="project-status"
              name="status"
              defaultValue={project.status}
              options={PROJECT_STATUSES.map((value) => ({ value, label: titleCase(value) }))}
            />
          </Field>

          <Field id="project-priority" label="Priority">
            <SelectField
              id="project-priority"
              name="priority"
              defaultValue={project.priority ?? 'medium'}
              options={PRIORITIES.map((value) => ({ value, label: titleCase(value) }))}
            />
          </Field>

          <Field id="project-start" label="Start date">
            <Input
              id="project-start"
              name="start_date"
              type="date"
              defaultValue={project.start_date ?? ''}
            />
          </Field>

          <Field id="project-end" label="End date">
            <Input
              id="project-end"
              name="end_date"
              type="date"
              defaultValue={project.end_date ?? ''}
            />
          </Field>
        </div>
      </SettingsForm>
    </fieldset>
  )
}
