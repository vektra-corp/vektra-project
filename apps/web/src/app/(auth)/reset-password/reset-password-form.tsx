'use client'

import { Alert, AlertDescription, Button, Label, PasswordInput } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useFormState, useFormStatus } from 'react-dom'
import { resetPassword } from '../actions'
import { authInputClass } from '../auth-card'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full rounded-[9px]" loading={pending}>
      Set new password
    </Button>
  )
}

/**
 * Choose a new password.
 *
 * Reached only after `verifyEmailCode('recovery', …)` has established a
 * session — this form does not re-check the code, it changes the password of
 * whoever the session belongs to. `resetPassword` signs out every other session
 * afterwards (§13.6).
 */
export function ResetPasswordForm() {
  const [state, formAction] = useFormState(resetPassword, null)

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={formAction} className="flex flex-col gap-[18px]">
      {state && !state.ok && state.code !== 'VALIDATION_ERROR' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>
            {state.code === 'UNAUTHORIZED'
              ? 'That reset link has expired. Request a new code.'
              : state.message}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="password" className="label-meta-lg text-subtle">New password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          autoFocus
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
