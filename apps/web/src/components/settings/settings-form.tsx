'use client'

import type { ActionResult } from '@pm/shared/types'
import { Alert, AlertDescription, Button, Label, cn } from '@pm/ui'
import { AlertCircle, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { useFormState, useFormStatus } from 'react-dom'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  )
}

/**
 * Settings form shell.
 *
 * Every settings pane is the same shape — a titled card, fields, one save button
 * and one result banner — so the shell owns the state plumbing and the panes
 * only describe their fields.
 */
export function SettingsForm({
  action,
  title,
  description,
  submitLabel = 'Save changes',
  children,
  footer,
}: {
  action: (prev: ActionResult<null> | null, formData: FormData) => Promise<ActionResult<null>>
  title: string
  description?: string
  submitLabel?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const [state, formAction] = useFormState(action, null)

  return (
    <form
      action={formAction}
      className="rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 className="text-ui font-semibold">{title}</h2>
        {description ? (
          <p className="pt-1 text-base text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="space-y-4 px-5 py-5">
        {state && !state.ok ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state?.ok ? (
          <Alert variant="success">
            <Check aria-hidden />
            <AlertDescription>Saved.</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
        <div className="text-nav text-faint">{footer}</div>
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  )
}

/** Labelled field row shared by every settings pane. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-nav text-faint">{hint}</p> : null}
      {error ? <p className="text-nav text-destructive">{error}</p> : null}
    </div>
  )
}

/** Native select styled to match Input. Used where a Radix Select is overkill. */
export function SelectField({
  id,
  name,
  defaultValue,
  options,
}: {
  id: string
  name: string
  defaultValue?: string
  options: { value: string; label: string }[]
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue}
      className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-ui transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
