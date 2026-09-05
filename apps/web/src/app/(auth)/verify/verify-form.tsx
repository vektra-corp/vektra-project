'use client'

import { Alert, AlertDescription, Button, Input, Label } from '@pm/ui'
import { AlertCircle, MailCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { resendEmailCode, verifyEmailCode } from '../actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" loading={pending}>
      Verify
    </Button>
  )
}

/**
 * Six-digit code entry.
 *
 * A code rather than a magic link because links in email get followed by
 * scanners and link previewers, which consumes a single-use token before the
 * person ever clicks it.
 */
export function VerifyForm({
  email,
  type,
  nextPath,
}: {
  email: string
  type: 'signup' | 'recovery'
  nextPath: string
}) {
  const [state, formAction] = useFormState(verifyEmailCode.bind(null, type), null)
  const [resendState, resendAction] = useFormState(resendEmailCode.bind(null, type), null)
  const [cooldown, setCooldown] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (state?.ok) router.push(nextPath)
  }, [state, router, nextPath])

  // A visible cooldown after a resend, so nobody hammers the button into the
  // rate limiter and then thinks the code never arrived.
  useEffect(() => {
    if (!resendState?.ok) return
    setCooldown(30)
    const id = setInterval(() => setCooldown((value) => (value <= 1 ? 0 : value - 1)), 1000)
    return () => clearInterval(id)
  }, [resendState])

  const error = state && !state.ok ? state.fieldErrors?.code?.[0] ?? state.message : undefined

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="email" value={email} />

        <div className="space-y-1.5">
          <Label htmlFor="code">Verification code</Label>
          <Input
            ref={inputRef}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            placeholder="000000"
            aria-invalid={Boolean(error)}
            className="text-center font-mono text-head tracking-[0.4em]"
          />
          {error ? <p className="text-nav text-destructive">{error}</p> : null}
        </div>

        <SubmitButton />
      </form>

      <form action={resendAction}>
        <input type="hidden" name="email" value={email} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send another code'}
        </Button>
      </form>

      {resendState?.ok && cooldown > 0 ? (
        <Alert variant="success">
          <MailCheck aria-hidden />
          <AlertDescription>
            If that address has an account, a new code is on its way.
          </AlertDescription>
        </Alert>
      ) : null}

      {resendState && !resendState.ok ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>
            {resendState.code === 'RATE_LIMITED'
              ? 'Too many attempts. Wait a minute and try again.'
              : resendState.message}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
