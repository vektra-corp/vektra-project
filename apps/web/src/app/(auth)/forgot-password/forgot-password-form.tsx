'use client'

import { Button, Input, Label } from '@pm/ui'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { requestPasswordReset } from '../actions'
import { authInputClass } from '../auth-card'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full rounded-[9px]" loading={pending}>
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
    <form action={formAction} className="flex flex-col gap-[18px]">
      <div className="space-y-2">
        <Label htmlFor="email" className="label-meta-lg text-subtle">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(emailError)}
          className={authInputClass}
        />
        {emailError ? <p className="text-nav text-destructive">{emailError}</p> : null}
      </div>
      <SubmitButton label={t('send_reset_link')} />
    </form>
  )
}
