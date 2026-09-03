'use client'

import { Alert, AlertDescription, Button, Input, Label } from '@pm/ui'
import { AlertCircle, MailCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import { signUp } from '../actions'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {label}
    </Button>
  )
}

export function SignupForm() {
  const t = useTranslations('auth')
  const [state, formAction] = useFormState(signUp, null)

  if (state?.ok) {
    return (
      <Alert variant="success">
        <MailCheck aria-hidden />
        <AlertDescription>
          <p className="font-medium">{t('verify_title')}</p>
          <p className="mt-1">{t('verify_subtitle', { email: state.data.email })}</p>
        </AlertDescription>
      </Alert>
    )
  }

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  const generalError =
    state && !state.ok && state.code !== 'VALIDATION_ERROR'
      ? state.code === 'RATE_LIMITED'
        ? t('rate_limited', { minutes: 15 })
        : state.message
      : null

  return (
    <form action={formAction} className="space-y-4">
      {generalError ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="full_name">{t('full_name')}</Label>
        <Input id="full_name" name="full_name" autoComplete="name" required />
        {fieldError('full_name') ? (
          <p className="text-xs text-destructive">{fieldError('full_name')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="organization_name">{t('organization_name')}</Label>
        <Input id="organization_name" name="organization_name" autoComplete="organization" required />
        {fieldError('organization_name') ? (
          <p className="text-xs text-destructive">{fieldError('organization_name')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
        {fieldError('email') ? (
          <p className="text-xs text-destructive">{fieldError('email')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {fieldError('password') ? (
          <p className="text-xs text-destructive">{fieldError('password')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm_password">{t('confirm_password')}</Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
        />
        {fieldError('confirm_password') ? (
          <p className="text-xs text-destructive">{fieldError('confirm_password')}</p>
        ) : null}
      </div>

      <div className="flex items-start gap-2">
        <input
          id="accept_terms"
          name="accept_terms"
          type="checkbox"
          required
          className="mt-1 h-4 w-4 rounded border-input"
        />
        <Label htmlFor="accept_terms" className="text-xs font-normal leading-relaxed">
          {t('accept_terms')}
        </Label>
      </div>
      {fieldError('accept_terms') ? (
        <p className="text-xs text-destructive">{fieldError('accept_terms')}</p>
      ) : null}

      <SubmitButton label={t('sign_up')} />
    </form>
  )
}
