'use client'

import { PRIORITIES } from '@pm/shared/constants'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from '@pm/ui'
import { AlertCircle, Pencil, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { saveAssignmentRule } from './actions'

export interface RuleRecord {
  id: string
  name: string
  isActive: boolean
  method: string
  projectId: string | null
  assigneePool: string[]
  priorities: string[]
  labels: string[]
  requiredSkills: string[]
  maxConcurrent: number | null
  respectLeave: boolean
}

const METHOD_HELP: Record<string, string> = {
  round_robin: 'Cycles through the list in order, skipping anyone on leave.',
  load_balanced: 'Picks whoever has the fewest open tasks.',
  skill_based: 'Matches required skills against the employee record, then falls back to round robin.',
  random: 'Picks at random. Useful for evenly spreading low-priority work.',
}

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {isNew ? 'Create rule' : 'Save changes'}
    </Button>
  )
}

export function RuleDialog({
  orgSlug,
  rule,
  members,
  projects,
}: {
  orgSlug: string
  rule?: RuleRecord
  members: { userId: string; fullName: string }[]
  projects: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const isNew = !rule
  const [method, setMethod] = useState(rule?.method ?? 'round_robin')
  const [state, formAction] = useFormState(
    saveAssignmentRule.bind(null, orgSlug, rule?.id ?? null),
    null,
  )
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      toast({ title: isNew ? 'Rule created' : 'Rule updated' })
      router.refresh()
    }
  }, [state, router, isNew])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <>
      {isNew ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          New rule
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${rule.name}`}
          onClick={() => setOpen(true)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isNew ? 'New assignment rule' : rule.name}</DialogTitle>
            <DialogDescription>
              Runs every couple of minutes against tasks created in the last hour that still have
              no assignee.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="rule-name" label="Name" error={fieldError('name')}>
              <Input
                id="rule-name"
                name="name"
                required
                autoFocus
                maxLength={120}
                defaultValue={rule?.name ?? ''}
                placeholder="High-priority bugs to the platform team"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="rule-method" label="Method" hint={METHOD_HELP[method]}>
                <SelectField
                  id="rule-method"
                  name="method"
                  defaultValue={rule?.method ?? 'round_robin'}
                  options={[
                    { value: 'round_robin', label: 'Round robin' },
                    { value: 'load_balanced', label: 'Load balanced' },
                    { value: 'skill_based', label: 'Skill based' },
                    { value: 'random', label: 'Random' },
                  ]}
                />
              </Field>

              <Field id="rule-project" label="Project" hint="Leave blank to apply org-wide.">
                <SelectField
                  id="rule-project"
                  name="project_id"
                  defaultValue={rule?.projectId ?? ''}
                  options={[
                    { value: '', label: 'All projects' },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                />
              </Field>
            </div>

            {/* Method-specific options. Rendered for the selected method only,
                so the form never shows a field the engine would ignore. */}
            <div
              className="grid gap-4 sm:grid-cols-2"
              onChange={(event) => {
                const target = event.target as HTMLSelectElement
                if (target.name === 'method') setMethod(target.value)
              }}
            >
              <Field
                id="rule-max"
                label="Max open tasks per person"
                hint="Load balanced only. Blank means no cap."
              >
                <Input
                  id="rule-max"
                  name="max_concurrent"
                  type="number"
                  min="1"
                  defaultValue={rule?.maxConcurrent ?? ''}
                />
              </Field>

              <Field
                id="rule-skills"
                label="Required skills"
                hint="Skill based only. Comma separated."
              >
                <Input
                  id="rule-skills"
                  name="required_skills"
                  defaultValue={rule?.requiredSkills.join(', ') ?? ''}
                  placeholder="react, postgres"
                />
              </Field>
            </div>

            <fieldset className="space-y-2">
              <legend className="pb-1 text-sm font-medium">
                Assign to
                {fieldError('assignee_pool') ? (
                  <span className="ps-2 text-xs font-normal text-destructive">
                    {fieldError('assignee_pool')}
                  </span>
                ) : null}
              </legend>
              <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
                {members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex cursor-pointer items-center gap-2.5 text-[13px]"
                  >
                    <Checkbox
                      name="assignee_pool"
                      value={member.userId}
                      size="sm"
                      defaultChecked={rule?.assigneePool.includes(member.userId)}
                    />
                    <span className="truncate">{member.fullName}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-faint">
                Round robin follows this order, so it stays stable as people come and go.
              </p>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="pb-1 text-sm font-medium">Only when</legend>

              <div className="flex flex-wrap gap-3">
                {PRIORITIES.map((priority) => (
                  <label
                    key={priority}
                    className="flex cursor-pointer items-center gap-2 text-[13px] capitalize"
                  >
                    <Checkbox
                      name="priority"
                      value={priority}
                      size="sm"
                      defaultChecked={rule?.priorities.includes(priority)}
                    />
                    {priority === 'critical' ? 'urgent' : priority}
                  </label>
                ))}
              </div>

              <Input
                name="labels"
                defaultValue={rule?.labels.join(', ') ?? ''}
                placeholder="Labels, comma separated — any one matches"
                className="mt-1"
              />
              <p className="text-xs text-faint">
                Leave both blank to apply to every new task.
              </p>
            </fieldset>

            <div className="space-y-1.5">
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <Checkbox name="respect_leave" size="sm" defaultChecked={rule?.respectLeave ?? true} />
                Skip anyone on approved leave
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                <Checkbox name="is_active" size="sm" defaultChecked={rule?.isActive ?? true} />
                Active
              </label>
            </div>

            <input type="hidden" name="trigger_event" value="task_created" />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton isNew={isNew} />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
