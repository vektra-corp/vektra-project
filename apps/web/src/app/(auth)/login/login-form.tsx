'use client'

import { Alert, AlertDescription, Button, Input, PasswordInput } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useFormState, useFormStatus } from 'react-dom'
import { signIn } from '../actions'
import { AuthField, authInputClass } from '../auth-card'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full rounded-[9px]" loading={pending}>
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
        : error === 'invite_expired'
          ? t('invite_expired')
          : error
            ? t('oauth_failed')
            : null

  // Once the form has been submitted, whatever came back from Google is stale
  // — the person has moved on from it.
  const errorMessage = state ? submitError : redirectError

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={formAction} className="flex flex-col gap-[22px]">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <AuthField htmlFor="email" label={t('email')} error={fieldError('email')}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={authInputClass}
          aria-invalid={Boolean(fieldError('email'))}
          aria-describedby={fieldError('email') ? 'email-error' : undefined}
        />
      </AuthField>

      <AuthField
        htmlFor="password"
        label={t('password')}
        error={fieldError('password')}
        aside={
          <Link
            href="/forgot-password"
            className="text-primary text-micro hover:underline"
          >
            {t('forgot_password')}
          </Link>
        }
      >
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          className={authInputClass}
          aria-invalid={Boolean(fieldError('password'))}
          showLabel={t('show_password')}
          hideLabel={t('hide_password')}
        />
      </AuthField>

      <SubmitButton label={t('sign_in')} />
    </form>
  )
}
