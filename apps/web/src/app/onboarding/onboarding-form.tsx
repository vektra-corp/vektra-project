'use client'

import { slugify } from '@pm/shared/utils'
import { Alert, AlertDescription, Button, Input, Label } from '@pm/ui'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { createOrganization } from './actions'

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {label}
    </Button>
  )
}

/**
 * The host this workspace address will live under.
 *
 * Was hard-coded to "app.example.com", so the very first screen of a new
 * account showed a placeholder domain next to the address the customer was
 * choosing. Read from the same variable the OAuth return trip uses, falling
 * back to the current origin so preview deployments read correctly too.
 */
function appHost(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (typeof window !== 'undefined') return window.location.host
  return 'app.example.com'
}

export function OnboardingForm({
  defaultName,
  defaultSlug,
}: {
  defaultName: string
  defaultSlug: string
}) {
  const t = useTranslations('onboarding')
  const host = appHost()
  const [state, formAction] = useFormState(createOrganization, null)
  const [slug, setSlug] = useState(defaultSlug)
  // Once the user edits the slug themselves, stop overwriting it from the name.
  const [slugTouched, setSlugTouched] = useState(false)

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  const slugError = fieldError('slug')

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && state.code === 'INTERNAL_ERROR' ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name">{t('org_name_label')}</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultName}
          required
          autoFocus
          onChange={(event) => {
            if (!slugTouched) setSlug(slugify(event.target.value))
          }}
        />
        {fieldError('name') ? (
          <p className="text-nav text-destructive">{fieldError('name')}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">{t('slug_label')}</Label>
        <div className="flex items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          <span className="ps-3 text-ui text-muted-foreground">{host}/</span>
          <Input
            id="slug"
            name="slug"
            value={slug}
            required
            aria-invalid={Boolean(slugError)}
            className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onChange={(event) => {
              setSlugTouched(true)
              setSlug(slugify(event.target.value))
            }}
          />
        </div>
        <p className="text-nav text-muted-foreground">{t('slug_help')}</p>
        {slugError ? (
          <p className="text-nav text-destructive">
            {slugError === 'onboarding.slug_taken' ? t('slug_taken') : slugError}
          </p>
        ) : null}
      </div>

      {/* Resolved from the browser so the first org defaults to the creator's zone. */}
      <input
        type="hidden"
        name="timezone"
        value={Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'}
      />

      <SubmitButton label={t('create')} />
    </form>
  )
}
