'use client'

import { Alert, AlertDescription, Button, Input, Label } from '@pm/ui'
import { MailCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import { requestPasswordReset } from '../actions'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {label}
    </Button>
  )
}

export function ForgotPasswordForm() {
  const t = useTranslations('auth')
  const [state, formAction] = useFormState(requestPasswordReset, null)

  // Success is reported whether or not the address is registered, so this screen
  // cannot be used to enumerate accounts.
  if (state?.ok) {
    return (
      <Alert variant="success">
        <MailCheck aria-hidden />
        <AlertDescription>{t('reset_link_sent')}</AlertDescription>
      </Alert>
    )
  }

  const emailError = state && !state.ok ? state.fieldErrors?.email?.[0] : undefined

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(emailError)}
        />
        {emailError ? <p className="text-xs text-destructive">{emailError}</p> : null}
      </div>
      <SubmitButton label={t('send_reset_link')} />
    </form>
  )
}
