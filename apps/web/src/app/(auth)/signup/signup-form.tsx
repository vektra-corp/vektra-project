'use client'

import { Alert, AlertDescription, Button, Input, Label, PasswordInput } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
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
  const tCommon = useTranslations('common')
  const [state, formAction] = useFormState(signUp, null)
  const router = useRouter()

  // Navigating from an effect rather than redirecting inside the action keeps
  // the validation errors renderable when the submit fails.
  useEffect(() => {
    if (state?.ok) {
      router.push(`/verify?email=${encodeURIComponent(state.data.email)}`)
    }
  }, [state, router])

  // Straight to the code entry — an interstitial saying "we sent a code" is a
  // step that only exists to be clicked through. /verify says the same thing
  // above the input it wants filled in.
  if (state?.ok) {
    return (
      <p className="py-8 text-center text-[13px] text-muted-foreground">{tCommon('loading')}</p>
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
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          showLabel={t('show_password')}
          hideLabel={t('hide_password')}
        />
        {fieldError('password') ? (
          <p className="text-xs text-destructive">{fieldError('password')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm_password">{t('confirm_password')}</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          required
          showLabel={t('show_password')}
          hideLabel={t('hide_password')}
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
