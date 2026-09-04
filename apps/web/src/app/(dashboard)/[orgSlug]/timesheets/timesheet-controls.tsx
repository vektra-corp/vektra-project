'use client'

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
  toast,
} from '@pm/ui'
import { AlertCircle, Check, ChevronLeft, ChevronRight, Plus, Send, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { decideTimesheet, logManualEntry, submitTimesheet } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Log time
    </Button>
  )
}

/** Previous / next week, with a "this week" escape hatch. */
export function WeekNav({
  base,
  weekStart,
  previousWeek,
  nextWeek,
  label,
  isCurrent,
}: {
  base: string
  weekStart: string
  previousWeek: string
  nextWeek: string
  label: string
  isCurrent: boolean
}) {
  return (
    <div className="flex items-center gap-1">
      <Button asChild variant="ghost" size="icon-sm" aria-label="Previous week">
        <Link href={`${base}?week=${previousWeek}`}>
          <ChevronLeft className="h-4 w-4 rtl-flip" aria-hidden />
        </Link>
      </Button>

      <span className="min-w-44 text-center text-[13px] font-medium">{label}</span>

      <Button asChild variant="ghost" size="icon-sm" aria-label="Next week">
        <Link href={`${base}?week=${nextWeek}`}>
          <ChevronRight className="h-4 w-4 rtl-flip" aria-hidden />
        </Link>
      </Button>

      {isCurrent ? null : (
        <Button asChild variant="ghost" size="xs">
          <Link href={base}>This week</Link>
        </Button>
      )}
      <span className="sr-only">Week beginning {weekStart}</span>
    </div>
  )
}

export function ManualEntryDialog({
  orgSlug,
  projects,
  defaultDate,
  disabled,
}: {
  orgSlug: string
  projects: { id: string; name: string }[]
  defaultDate: string
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useFormState(logManualEntry.bind(null, orgSlug), null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      toast({ title: 'Time logged' })
      router.refresh()
    }
  }, [state, router])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <>
      <Button
        variant="subtle"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled || projects.length === 0}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        Add time
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log time</DialogTitle>
            <DialogDescription>
              For work you did without running the timer.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="me-project" label="Project" error={fieldError('project_id')}>
              <SelectField
                id="me-project"
                name="project_id"
                options={projects.map((project) => ({ value: project.id, label: project.name }))}
              />
            </Field>

            <Field id="me-description" label="Description">
              <Input id="me-description" name="description" maxLength={500} autoFocus />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="me-date" label="Date" error={fieldError('entry_date')}>
                <Input
                  id="me-date"
                  name="entry_date"
                  type="date"
                  required
                  defaultValue={defaultDate}
                />
              </Field>
              <Field
                id="me-minutes"
                label="Minutes"
                hint="90 for an hour and a half."
                error={fieldError('duration_minutes')}
              >
                <Input
                  id="me-minutes"
                  name="duration_minutes"
                  type="number"
                  min="1"
                  max="1440"
                  required
                />
              </Field>
            </div>

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

export function SubmitWeekButton({
  orgSlug,
  periodStart,
  periodEnd,
  status,
  totalMinutes,
}: {
  orgSlug: string
  periodStart: string
  periodEnd: string
  status: string | null
  totalMinutes: number
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  if (status === 'submitted') {
    return (
      <span className="label-meta rounded bg-surface-hover px-2 py-1.5 text-muted-foreground">
        Awaiting approval
      </span>
    )
  }
  if (status === 'approved') {
    return (
      <span className="label-meta rounded bg-success/15 px-2 py-1.5 text-success">Approved</span>
    )
  }

  return (
    <Button
      size="sm"
      loading={pending}
      disabled={totalMinutes === 0}
      onClick={() =>
        startTransition(async () => {
          const result = await submitTimesheet(orgSlug, periodStart, periodEnd)
          if (result.ok) {
            toast({ title: 'Timesheet submitted' })
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Could not submit', description: result.message })
          }
        })
      }
    >
      <Send className="h-3.5 w-3.5" aria-hidden />
      {status === 'rejected' ? 'Resubmit' : 'Submit week'}
    </Button>
  )
}

export function TimesheetDecision({
  orgSlug,
  periodId,
}: {
  orgSlug: string
  periodId: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function decide(status: 'approved' | 'rejected') {
    startTransition(async () => {
      const note =
        status === 'rejected' ? (window.prompt('Reason for rejection (optional)') ?? '') : ''
      const result = await decideTimesheet(orgSlug, periodId, status, note || undefined)
      if (result.ok) {
        toast({ title: status === 'approved' ? 'Timesheet approved' : 'Timesheet rejected' })
        router.refresh()
      } else {
        toast({ variant: 'destructive', title: 'Could not decide', description: result.message })
      }
    })
  }

  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Approve"
        loading={pending}
        onClick={() => decide('approved')}
      >
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Reject"
        disabled={pending}
        onClick={() => decide('rejected')}
      >
        <X className="h-3.5 w-3.5 text-destructive" aria-hidden />
      </Button>
    </span>
  )
}
