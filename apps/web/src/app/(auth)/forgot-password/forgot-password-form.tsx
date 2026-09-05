'use client'

import { Button, Input, Label } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
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
  const tCommon = useTranslations('common')
  const [state, formAction] = useFormState(requestPasswordReset, null)
  const router = useRouter()

  useEffect(() => {
    if (state?.ok) {
      router.push(`/verify?type=recovery&email=${encodeURIComponent(state.data.email)}`)
    }
  }, [state, router])

  // Success is reported whether or not the address is registered, so this screen
  // cannot be used to enumerate accounts.
  if (state?.ok) {
    return <p className="py-8 text-center text-base text-muted-foreground">{tCommon('loading')}</p>
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
        {emailError ? <p className="text-nav text-destructive">{emailError}</p> : null}
      </div>
      <SubmitButton label={t('send_reset_link')} />
    </form>
  )
}
