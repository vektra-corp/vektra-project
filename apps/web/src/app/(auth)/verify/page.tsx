import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { VerifyForm } from './verify-form'

export const metadata: Metadata = { title: 'Verify your email' }

export default function VerifyPage({
  searchParams,
}: {
  searchParams: { email?: string; type?: string }
}) {
  const email = (searchParams.email ?? '').trim()
  // Without an address there is nothing to verify against, and guessing one
  // would let this page be used to probe for accounts.
  if (!email) redirect('/signup')

  const type = searchParams.type === 'recovery' ? 'recovery' : 'signup'

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Check your email</CardTitle>
        <CardDescription>
          We sent a six-digit code to <span className="text-foreground">{email}</span>. It expires
          in an hour.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <VerifyForm
          email={email}
          type={type}
          nextPath={type === 'recovery' ? '/reset-password' : '/onboarding'}
        />

        <p className="text-center text-xs text-muted-foreground">
          Wrong address?{' '}
          <Link href="/signup" className="text-primary hover:underline">
            Start again
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
