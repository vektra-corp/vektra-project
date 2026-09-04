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
import {
  createWorkflow,
  deleteWorkflow,
  rotateWebhookToken,
  saveWorkflowGraph,
  setWorkflowActive,
} from './actions'

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

  const mintedToken = state?.ok ? state.data.webhookToken : undefined

  useEffect(() => {
    // A minted token is shown once and never again, so hold the dialog open
    // until it has been acknowledged rather than navigating past it.
    if (state?.ok && !state.data.webhookToken) {
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

          {mintedToken && state?.ok ? (
            <TokenReveal
              token={mintedToken}
              onDone={() => {
                setOpen(false)
                router.push(`/${scope.orgSlug}/${scope.workspaceSlug}/workflows/${state.data.id}`)
              }}
            />
          ) : (
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

            {trigger === 'schedule' ? <ScheduleFields /> : null}

            {trigger === 'webhook' ? (
              <p className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
                A trigger URL is generated when you create this workflow. It is shown once
                and cannot be retrieved later — copy it before closing.
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** Frequency plus the fields that frequency actually needs. */
function ScheduleFields() {
  const [frequency, setFrequency] = useState('daily')

  return (
    <div className="space-y-3 rounded-md border border-border-subtle bg-surface-raised p-3">
      <div
        onChange={(event) => {
          const target = event.target as HTMLSelectElement
          if (target.name === 'schedule_frequency') setFrequency(target.value)
        }}
      >
        <Field id="wf-freq" label="Runs">
          <SelectField
            id="wf-freq"
            name="schedule_frequency"
            defaultValue="daily"
            options={[
              { value: 'hourly', label: 'Every hour' },
              { value: 'daily', label: 'Every day' },
              { value: 'weekly', label: 'Every week' },
              { value: 'monthly', label: 'Every month' },
            ]}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {frequency === 'weekly' ? (
          <Field id="wf-weekday" label="Day">
            <SelectField
              id="wf-weekday"
              name="schedule_weekday"
              defaultValue="1"
              options={[
                { value: '1', label: 'Monday' },
                { value: '2', label: 'Tuesday' },
                { value: '3', label: 'Wednesday' },
                { value: '4', label: 'Thursday' },
                { value: '5', label: 'Friday' },
                { value: '6', label: 'Saturday' },
                { value: '0', label: 'Sunday' },
              ]}
            />
          </Field>
        ) : null}

        {frequency === 'monthly' ? (
          <Field id="wf-day" label="Day of month" hint="1-28.">
            <Input id="wf-day" name="schedule_day" type="number" min={1} max={28} defaultValue={1} />
          </Field>
        ) : null}

        {frequency !== 'hourly' ? (
          <Field id="wf-hour" label="Hour">
            <Input id="wf-hour" name="schedule_hour" type="number" min={0} max={23} defaultValue={9} />
          </Field>
        ) : null}

        <Field id="wf-minute" label="Minute">
          <Input id="wf-minute" name="schedule_minute" type="number" min={0} max={59} defaultValue={0} />
        </Field>
      </div>

      <p className="text-xs text-faint">Times are in the organization&apos;s timezone.</p>
    </div>
  )
}

/**
 * Show a freshly minted token once.
 *
 * There is no going back to it: the server stores only a hash, so this panel is
 * the single opportunity to copy it. It blocks rather than auto-dismissing for
 * that reason.
 */
function TokenReveal({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/api/webhooks/workflows/${token}`

  return (
    <div className="space-y-3">
      <Alert>
        <AlertCircle aria-hidden />
        <AlertDescription>
          Copy this URL now. It is stored hashed, so it cannot be shown again — you would
          have to generate a new one.
        </AlertDescription>
      </Alert>

      <code className="block break-all rounded-md border border-border-subtle bg-surface-raised p-3 font-mono text-[11px] text-muted-foreground">
        {url}
      </code>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(url)
            setCopied(true)
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          {copied ? 'Copied' : 'Copy URL'}
        </Button>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  )
}

/** The trigger URL panel on a webhook workflow's page. */
export function WebhookTrigger({
  scope,
  workflowId,
  hasToken,
  canEdit,
}: {
  scope: Scope
  workflowId: string
  hasToken: boolean
  canEdit: boolean
}) {
  const [token, setToken] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const rotate = () => {
    startTransition(async () => {
      const result = await rotateWebhookToken(scope, workflowId)
      if (result.ok) {
        setToken(result.data.token)
        router.refresh()
      } else {
        toast({ title: result.message, variant: 'destructive' })
      }
    })
  }

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle bg-surface px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label-meta text-faint">Webhook</span>
        <span className="text-muted-foreground">
          {hasToken
            ? 'A trigger URL exists. It is stored hashed and cannot be displayed again.'
            : 'No trigger URL yet.'}
        </span>
        {canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ms-auto"
            disabled={pending}
            onClick={rotate}
          >
            {hasToken ? 'Generate a new URL' : 'Generate URL'}
          </Button>
        ) : null}
      </div>

      {token ? (
        <>
          <p className="text-muted-foreground">
            Copy this now — the old URL has stopped working and this one will not be shown again.
          </p>
          <code className="block break-all rounded-md border border-border-subtle bg-surface-raised p-2.5 font-mono text-[11px] text-muted-foreground">
            {`${typeof window === 'undefined' ? '' : window.location.origin}/api/webhooks/workflows/${token}`}
          </code>
        </>
      ) : null}
    </div>
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
