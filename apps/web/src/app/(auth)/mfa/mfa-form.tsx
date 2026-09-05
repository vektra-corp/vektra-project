'use client'

import { Alert, AlertDescription, Button, Input } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useFormState, useFormStatus } from 'react-dom'
import { verifySecondFactor } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" loading={pending}>
      Verify
    </Button>
  )
}

export function MfaChallengeForm({ next }: { next?: string }) {
  const [state, formAction] = useFormState(verifySecondFactor, null)

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <h1 className="text-base font-semibold tracking-tight">Two-step verification</h1>
        <p className="pt-1 text-[13px] text-muted-foreground">
          Enter the six-digit code from your authenticator app.
        </p>
      </div>

      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div className="space-y-2">
        <label htmlFor="mfa-code" className="text-sm font-medium">
          Code
        </label>
        <Input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          // Lets a password manager or the OS fill it, the same affordance the
          // email verification screen gets.
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          placeholder="123456"
          className="text-center font-mono text-lg tracking-[0.4em]"
        />
      </div>

      <SubmitButton />

      <p className="text-xs text-faint">
        Lost your device? An owner or admin of your organization can remove the factor
        for you.
      </p>
    </form>
  )
}
