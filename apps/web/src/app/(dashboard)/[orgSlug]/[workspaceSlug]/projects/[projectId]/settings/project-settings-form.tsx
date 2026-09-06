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
  publicId,
  canEdit,
}: {
  scope: { orgSlug: string; workspaceSlug: string; projectId: string }
  project: {
    key: string
    name: string
    description: string | null
    status: string
    priority: string | null
    start_date: string | null
    end_date: string | null
  }
  /** The generated 16-digit id. Shown, never edited. */
  publicId: string
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

        {/*
         * The two identifiers, side by side, because the difference between them
         * is easiest to understand when they are seen together: the key is
         * yours to choose and appears in every task reference; the public id is
         * generated once and is what every link to this project is built from.
         */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="project-key"
            label="Project key"
            hint="Used in task references, e.g. VEK-241. Unique in this organization."
          >
            <Input
              id="project-key"
              name="key"
              defaultValue={project.key}
              required
              minLength={2}
              maxLength={10}
              pattern="[A-Za-z][A-Za-z0-9]{1,9}"
              // Upper-cased as it is typed, so the value shown is the value stored.
              className="font-mono uppercase"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>

          <Field id="project-public-id" label="Project ID" hint="Generated. Cannot be changed.">
            <Input
              id="project-public-id"
              value={publicId}
              readOnly
              disabled
              className="font-mono tabular-nums"
            />
          </Field>
        </div>

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
