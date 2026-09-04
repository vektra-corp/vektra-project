'use client'

import { parseGraph, type WorkflowGraph } from '@pm/shared/constants'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
  toast,
} from '@pm/ui'
import { AlertCircle, Check, Plus, Save, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { WorkflowCanvas } from '@/components/workflows/canvas'
import { createWorkflow, deleteWorkflow, saveWorkflowGraph, setWorkflowActive } from './actions'

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Create workflow
    </Button>
  )
}

export function NewWorkflowDialog({ scope }: { scope: Scope }) {
  const [open, setOpen] = useState(false)
  const [trigger, setTrigger] = useState('task_event')
  const [state, formAction] = useFormState(createWorkflow.bind(null, scope), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      router.push(`/${scope.orgSlug}/${scope.workspaceSlug}/workflows/${state.data.id}`)
    }
  }, [state, router, scope])

  const fieldError = (name: string) =>
    state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" aria-hidden />
        New workflow
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New workflow</DialogTitle>
            <DialogDescription>
              Starts inactive with just a trigger. Build the graph, then activate it.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="wf-name" label="Name" error={fieldError('name')}>
              <Input
                id="wf-name"
                name="name"
                required
                autoFocus
                maxLength={120}
                placeholder="Notify on urgent bugs"
              />
            </Field>

            <Field id="wf-description" label="Description">
              <Textarea id="wf-description" name="description" rows={2} />
            </Field>

            <div onChange={(event) => {
              const target = event.target as HTMLSelectElement
              if (target.name === 'trigger_type') setTrigger(target.value)
            }}>
              <Field id="wf-trigger" label="Trigger">
                <SelectField
                  id="wf-trigger"
                  name="trigger_type"
                  defaultValue="task_event"
                  options={[
                    { value: 'task_event', label: 'When a task changes' },
                    { value: 'subtask_event', label: 'When a subtask changes' },
                    { value: 'commercial_event', label: 'When a commercial document changes' },
                    { value: 'schedule', label: 'On a schedule' },
                    { value: 'webhook', label: 'From a webhook' },
                    { value: 'manual', label: 'Manually' },
                  ]}
                />
              </Field>
            </div>

            {trigger === 'schedule' ? (
              <Field
                id="wf-cron"
                label="Cron expression"
                hint="Five fields, in the organization's timezone."
                error={fieldError('cron_expression')}
              >
                <Input id="wf-cron" name="cron_expression" placeholder="0 9 * * 1-5" />
              </Field>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Canvas plus save / activate, kept together so both see the same graph state. */
export function WorkflowEditor({
  scope,
  workflowId,
  initialGraph,
  isActive,
  canEdit,
}: {
  scope: Scope
  workflowId: string
  initialGraph: unknown
  isActive: boolean
  canEdit: boolean
}) {
  const [graph, setGraph] = useState<WorkflowGraph>(() => parseGraph(initialGraph))
  const [dirty, setDirty] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function update(next: WorkflowGraph) {
    setGraph(next)
    setDirty(true)
  }

  function save() {
    startTransition(async () => {
      const result = await saveWorkflowGraph(scope, workflowId, graph)
      if (result.ok) {
        setDirty(false)
        toast({
          title: 'Saved',
          description:
            result.data.problems > 0
              ? `${result.data.problems} problem${result.data.problems === 1 ? '' : 's'} to fix before activating.`
              : undefined,
        })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not save', description: result.message })
      }
    })
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await setWorkflowActive(scope, workflowId, !isActive)
      if (result.ok) {
        toast({ title: isActive ? 'Workflow paused' : 'Workflow activated' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not activate', description: result.message })
      }
    })
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="label-meta text-warning">Unsaved changes</span>
          ) : (
            <span className="label-meta text-faint">Saved</span>
          )}

          <div className="ms-auto flex items-center gap-2">
            <Button variant="subtle" size="sm" loading={pending} onClick={save} disabled={!dirty}>
              <Save className="h-3.5 w-3.5" aria-hidden />
              Save
            </Button>
            <Button
              size="sm"
              variant={isActive ? 'outline' : 'default'}
              loading={pending}
              onClick={toggleActive}
              // Activating an unsaved graph would activate the last saved one,
              // which is not what the canvas is showing.
              disabled={dirty}
              title={dirty ? 'Save first' : undefined}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              {isActive ? 'Pause' : 'Activate'}
            </Button>
          </div>
        </div>
      ) : null}

      <WorkflowCanvas graph={graph} onChange={update} readOnly={!canEdit} />
    </div>
  )
}

export function DeleteWorkflowButton({
  scope,
  workflowId,
  name,
}: {
  scope: Scope
  workflowId: string
  name: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{name}”?</DialogTitle>
            <DialogDescription>
              Its run history goes with it. Pausing keeps both.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteWorkflow(scope, workflowId)
                  if (result.ok) {
                    toast({ title: 'Workflow deleted' })
                    router.push(`/${scope.orgSlug}/${scope.workspaceSlug}/workflows`)
                  } else {
                    toast({
                      variant: 'destructive',
                      title: 'Could not delete',
                      description: result.message,
                    })
                  }
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
