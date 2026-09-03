import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const t = await getTranslations('auth')

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">{t('login_title')}</CardTitle>
        <CardDescription>{t('login_subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={searchParams.next} />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('no_account')}{' '}
          <Link href="/signup" className="font-medium text-primary hover:underline">
            {t('sign_up')}
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
