import { TRIAL_DAYS } from '@pm/shared/constants'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SignupForm } from './signup-form'

export const metadata: Metadata = { title: 'Create an account' }

export default async function SignupPage() {
  const t = await getTranslations('auth')

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{t('signup_title')}</CardTitle>
        <CardDescription>{t('signup_subtitle', { days: TRIAL_DAYS })}</CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('have_account')}{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t('sign_in')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
