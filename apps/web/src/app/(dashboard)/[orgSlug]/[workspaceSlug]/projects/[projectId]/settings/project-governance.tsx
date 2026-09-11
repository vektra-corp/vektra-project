'use client'

import {
  TASK_CREATE_POLICIES,
  TASK_CREATE_POLICY_DESCRIPTIONS,
  TASK_CREATE_POLICY_LABELS,
  type ProjectSettings,
  type TaskCreatePolicy,
} from '@pm/shared/constants'
import { Checkbox, toast } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateProjectGovernance } from './actions'

/**
 * How this project is run: who may open work, and whether it staffs itself.
 *
 * Saved on change rather than behind a Save button — each control is one
 * independent decision, and a form that batches them invites someone to flip a
 * switch, navigate away, and never find out it did not stick.
 */
export function ProjectGovernance({
  scope,
  settings,
  canEdit,
}: {
  scope: { orgSlug: string; workspaceSlug: string; projectId: string }
  settings: ProjectSettings
  canEdit: boolean
}) {
  const [value, setValue] = useState(settings)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function save(patch: Partial<ProjectSettings>, description: string) {
    const previous = value
    const next = { ...value, ...patch }
    setValue(next)

    startTransition(async () => {
      const result = await updateProjectGovernance(scope, patch)
      if (!result.ok) {
        // Put the control back where it was: leaving it showing the value the
        // server refused is how someone comes to believe a setting is on.
        setValue(previous)
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
        return
      }
      toast({ title: description })
      router.refresh()
    })
  }

  return (
    <section className="border-border bg-surface shadow-card rounded-lg border">
      <div className="border-border-subtle border-b px-5 py-4">
        <h2 className="text-ui font-semibold">Permissions &amp; automation</h2>
        <p className="text-muted-foreground pt-1 text-base">
          Applies to this project only. Organization roles still apply on top.
        </p>
      </div>

      <div className="divide-border-subtle divide-y">
        <fieldset className="px-5 py-4" disabled={!canEdit || pending}>
          <legend className="text-ui font-medium">Who can create tasks</legend>
          <div className="space-y-2 pt-2.5">
            {TASK_CREATE_POLICIES.map((policy: TaskCreatePolicy) => (
              <label
                key={policy}
                className="border-border-subtle hover:border-border has-[:checked]:border-primary/60 has-[:checked]:bg-primary/5 flex cursor-pointer gap-3 rounded-md border p-3 transition-colors"
              >
                <input
                  type="radio"
                  name="task_create"
                  value={policy}
                  checked={value.taskCreate === policy}
                  onChange={() =>
                    save({ taskCreate: policy }, `Task creation: ${TASK_CREATE_POLICY_LABELS[policy]}`)
                  }
                  className="mt-0.5 accent-[hsl(var(--primary))]"
                />
                <span className="min-w-0">
                  <span className="block text-base font-medium">
                    {TASK_CREATE_POLICY_LABELS[policy]}
                  </span>
                  <span className="text-muted-foreground block pt-0.5 text-nav leading-relaxed">
                    {TASK_CREATE_POLICY_DESCRIPTIONS[policy]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-medium">Auto-assign new tasks</p>
            <p className="text-muted-foreground pt-0.5 text-nav leading-relaxed">
              Unassigned tasks are handed to someone on this project using your automation rules.
              Only people who are actually project members are ever chosen.
            </p>
          </div>
          <Checkbox
            className="mt-0.5 shrink-0"
            checked={value.autoAssign}
            disabled={!canEdit || pending}
            onChange={(event) =>
              save(
                { autoAssign: event.target.checked },
                event.target.checked ? 'Auto-assign on' : 'Auto-assign off',
              )
            }
            aria-label="Auto-assign new tasks"
          />
        </div>

        <div className="flex items-start justify-between gap-6 px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-medium">Include managers</p>
            <p className="text-muted-foreground pt-0.5 text-nav leading-relaxed">
              Members are always offered work first. Turn this on to let managers and admins on the
              project pick up the overflow when no member is available.
            </p>
          </div>
          <Checkbox
            className="mt-0.5 shrink-0"
            checked={value.autoAssignManagers}
            disabled={!canEdit || pending || !value.autoAssign}
            onChange={(event) =>
              save(
                { autoAssignManagers: event.target.checked },
                event.target.checked ? 'Managers included' : 'Managers excluded',
              )
            }
            aria-label="Include managers in auto-assignment"
          />
        </div>
      </div>
    </section>
  )
}
