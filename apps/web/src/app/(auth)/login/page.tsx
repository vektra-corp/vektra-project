import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '../auth-card'
import { SocialAuth } from '../social-auth'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string }
}) {
  const t = await getTranslations('auth')

  return (
    <AuthCard title={t('login_title')} description={t('login_subtitle')}>
      <LoginForm next={searchParams.next} error={searchParams.error} />
      <SocialAuth next={searchParams.next} />
      <p className="text-faint text-center text-ui">
        {t('no_account')}{' '}
        <Link href="/signup" className="text-primary font-medium hover:underline">
          {t('sign_up')}
        </Link>
      </p>
    </AuthCard>
  )
}
