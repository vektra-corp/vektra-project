import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthCard } from '../auth-card'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata: Metadata = { title: 'Reset your password' }

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth')

  return (
    <AuthCard
      title={t('forgot_password_title')}
      description={t('forgot_password_subtitle')}
    >
      <ForgotPasswordForm />
      <p className="text-center text-ui">
        <Link href="/login" className="text-primary font-medium hover:underline">
          {t('sign_in')}
        </Link>
      </p>
    </AuthCard>
  )
}
