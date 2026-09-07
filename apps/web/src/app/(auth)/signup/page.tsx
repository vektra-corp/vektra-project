import { TRIAL_DAYS } from '@pm/shared/constants'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '../auth-card'
import { SocialAuth } from '../social-auth'
import { SignupForm } from './signup-form'

export const metadata: Metadata = { title: 'Create an account' }

export default async function SignupPage() {
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('signup_title')}
      description={t('signup_subtitle', { days: TRIAL_DAYS })}
    >
      <SignupForm />
      <SocialAuth />
      <p className="text-faint text-center text-ui">
        {t('have_account')}{' '}
        <Link href="/login" className="text-primary font-medium hover:underline">
          {t('sign_in')}
        </Link>
      </p>
    </AuthCard>
  )
}
