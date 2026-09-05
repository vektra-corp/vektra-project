'use client'

import { Alert, AlertDescription, Button, Input, Label, PasswordInput } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import { signIn } from '../actions'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {label}
    </Button>
  )
}

export function LoginForm({ next, error }: { next?: string; error?: string }) {
  const t = useTranslations('auth')
  const [state, formAction] = useFormState(signIn, null)

  // The action returns a message KEY, never localized text — the API layer is
  // locale-agnostic and the client maps codes to strings (§21.8).
  const submitError =
    state && !state.ok
      ? state.code === 'RATE_LIMITED'
        ? t('rate_limited', { minutes: 15 })
        : state.code === 'EMAIL_NOT_CONFIRMED'
          ? t('email_not_confirmed')
          : state.code === 'VALIDATION_ERROR'
            ? null
            : t('invalid_credentials')
      : null

  // A failed round trip through Google comes back as ?error= on this page,
  // since there is nowhere else to put it — the provider owns the screen in
  // between. Anything unrecognised is reported as a generic failure rather
  // than echoed, because the value arrives from outside.
  const redirectError =
    error === 'oauth_cancelled'
      ? t('oauth_cancelled')
      : error === 'rate_limited'
        ? t('rate_limited', { minutes: 15 })
        : error
          ? t('oauth_failed')
          : null

  // Once the form has been submitted, whatever came back from Google is stale
  // — the person has moved on from it.
  const errorMessage = state ? submitError : redirectError

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={formAction} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(fieldError('email'))}
          aria-describedby={fieldError('email') ? 'email-error' : undefined}
        />
        {fieldError('email') ? (
          <p id="email-error" className="text-nav text-destructive">
            {fieldError('email')}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('password')}</Label>
          <Link
            href="/forgot-password"
            className="text-nav text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('forgot_password')}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={Boolean(fieldError('password'))}
          showLabel={t('show_password')}
          hideLabel={t('hide_password')}
        />
        {fieldError('password') ? (
          <p className="text-nav text-destructive">{fieldError('password')}</p>
        ) : null}
      </div>

      <SubmitButton label={t('sign_in')} />
    </form>
  )
}
