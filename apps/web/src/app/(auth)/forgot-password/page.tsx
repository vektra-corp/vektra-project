import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ForgotPasswordForm } from './forgot-password-form'

export const metadata: Metadata = { title: 'Reset your password' }

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth')

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-head">{t('forgot_password_title')}</CardTitle>
        <CardDescription>{t('forgot_password_subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ForgotPasswordForm />
        <p className="mt-6 text-center text-ui text-muted-foreground">
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t('sign_in')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
