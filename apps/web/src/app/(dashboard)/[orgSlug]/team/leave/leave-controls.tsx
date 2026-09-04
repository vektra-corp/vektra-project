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
import { AlertCircle, CalendarPlus, Check, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Field, SelectField } from '@/components/settings/settings-form'
import { cancelLeave, decideLeave, requestLeave } from '../actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      Request leave
    </Button>
  )
}

/** Inclusive span in days between two `yyyy-MM-dd` strings. */
function spanDays(start: string, end: string): number {
  if (!start || !end) return 0
  const from = Date.parse(start)
  const to = Date.parse(end)
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return 0
  return Math.round((to - from) / 86_400_000) + 1
}

export function RequestLeaveDialog({
  orgSlug,
  leaveTypes,
  hasEmployeeRecord,
}: {
  orgSlug: string
  leaveTypes: { id: string; name: string }[]
  hasEmployeeRecord: boolean
}) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [duration, setDuration] = useState('')
  const [state, formAction] = useFormState(requestLeave.bind(null, orgSlug), null)
  const router = useRouter()

  const span = useMemo(() => spanDays(start, end), [start, end])

  // Default the duration to the full span, but leave it editable — half-days
  // and public holidays are exactly why it is a separate field.
  useEffect(() => {
    if (span > 0) setDuration(String(span))
  }, [span])

  useEffect(() => {
    if (state?.ok) {
      setOpen(false)
      setStart('')
      setEnd('')
      toast({ title: 'Leave requested' })
      router.refresh()
    }
  }, [state, router])

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!hasEmployeeRecord || leaveTypes.length === 0}
        title={
          !hasEmployeeRecord
            ? 'You need an employee record first'
            : leaveTypes.length === 0
              ? 'No leave types configured'
              : undefined
        }
      >
        <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
        Request leave
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request leave</DialogTitle>
            <DialogDescription>
              Your manager is notified and the days are held against your balance until they decide.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} className="space-y-4">
            {state && !state.ok && !state.fieldErrors ? (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}

            <Field id="leave_type_id" label="Leave type" error={fieldError('leave_type_id')}>
              <SelectField
                id="leave_type_id"
                name="leave_type_id"
                options={leaveTypes.map((type) => ({ value: type.id, label: type.name }))}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="start_date" label="From" error={fieldError('start_date')}>
                <Input
                  id="start_date"
                  name="start_date"
                  type="date"
                  required
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </Field>
              <Field id="end_date" label="To" error={fieldError('end_date')}>
                <Input
                  id="end_date"
                  name="end_date"
                  type="date"
                  required
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </Field>
            </div>

            <Field
              id="duration_days"
              label="Days"
              hint={span > 0 ? `${span} calendar days selected` : undefined}
              error={fieldError('duration_days')}
            >
              <Input
                id="duration_days"
                name="duration_days"
                type="number"
                step="0.5"
                min="0.5"
                required
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
            </Field>

            <Field id="reason" label="Reason">
              <Input id="reason" name="reason" maxLength={500} />
            </Field>

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

/** Approve / reject controls, shown only to someone who may decide. */
export function LeaveDecision({
  orgSlug,
  requestId,
}: {
  orgSlug: string
  requestId: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function decide(status: 'approved' | 'rejected') {
    startTransition(async () => {
      const note =
        status === 'rejected' ? (window.prompt('Reason for rejection (optional)') ?? '') : ''
      const result = await decideLeave(orgSlug, requestId, status, note || undefined)
      if (result.ok) {
        toast({ title: status === 'approved' ? 'Leave approved' : 'Leave rejected' })
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

export function CancelLeaveButton({
  orgSlug,
  requestId,
}: {
  orgSlug: string
  requestId: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  return (
    <Button
      variant="ghost"
      size="xs"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelLeave(orgSlug, requestId)
          if (result.ok) {
            toast({ title: 'Request withdrawn' })
            router.refresh()
          } else {
            toast({ variant: 'destructive', title: 'Could not cancel', description: result.message })
          }
        })
      }
    >
      Withdraw
    </Button>
  )
}
