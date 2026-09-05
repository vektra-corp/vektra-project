'use client'

import { Button } from '@pm/ui'
import { useTranslations } from 'next-intl'
import { useFormStatus } from 'react-dom'
import { signInWithGoogle } from './actions'

/** Google's mark, inlined so the button renders before any network round trip. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function GoogleButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="subtle" className="w-full" loading={pending}>
      {pending ? null : <GoogleMark />}
      {label}
    </Button>
  )
}

/**
 * "Or continue with Google", under the email form on /login and /signup.
 *
 * One component for both screens because the flow is identical: Google has no
 * notion of signing up versus signing in, and the callback lands a brand new
 * account on /onboarding and a returning one on their dashboard either way.
 *
 * `next` is carried through the provider round trip so a deep link that bounced
 * someone to /login still gets them where they were going.
 */
export function SocialAuth({ next }: { next?: string }) {
  const t = useTranslations('auth')

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-faint">{t('continue_with')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={signInWithGoogle}>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <GoogleButton label={t('continue_with_google')} />
      </form>
    </div>
  )
}
