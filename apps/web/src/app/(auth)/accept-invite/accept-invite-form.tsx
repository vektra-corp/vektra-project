'use client'

import { Alert, AlertDescription, Button, Input, Label, PasswordInput } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useFormState, useFormStatus } from 'react-dom'
import { authInputClass } from '../auth-card'
import { acceptInvite } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full rounded-[9px]" loading={pending}>
      Set password and continue
    </Button>
  )
}

/**
 * Name and password for a newly invited account.
 *
 * The email is shown but not editable: it is the address the invitation was
 * sent to and the identity the membership was created against, so changing it
 * here would mean accepting an invitation addressed to someone else.
 */
export function AcceptInviteForm({
  orgSlug,
  email,
  defaultName,
}: {
  orgSlug: string
  email: string
  defaultName: string
}) {
  const [state, formAction] = useFormState(acceptInvite.bind(null, orgSlug), null)

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={formAction} className="flex flex-col gap-[18px]">
      {state && !state.ok && state.code !== 'VALIDATION_ERROR' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="invite-email" className="label-meta-lg text-subtle">Email</Label>
        <Input id="invite-email" value={email} readOnly disabled autoComplete="username"
          className={authInputClass} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="full_name" className="label-meta-lg text-subtle">Your name</Label>
        <Input
          id="full_name"
          name="full_name"
          defaultValue={defaultName}
          required
          maxLength={150}
          autoFocus
          autoComplete="name"
          className={authInputClass}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="label-meta-lg text-subtle">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={Boolean(fieldError('password'))}
          className={authInputClass}
        />
        {fieldError('password') ? (
          <p className="text-nav text-destructive">{fieldError('password')}</p>
        ) : (
          <p className="text-nav text-faint">At least 8 characters.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm_password" className="label-meta-lg text-subtle">Confirm password</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(fieldError('confirm_password'))}
          className={authInputClass}
        />
        {fieldError('confirm_password') ? (
          <p className="text-nav text-destructive">{fieldError('confirm_password')}</p>
        ) : null}
      </div>

      <SubmitButton />
    </form>
  )
}
