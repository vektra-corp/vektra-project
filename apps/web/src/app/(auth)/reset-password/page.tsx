import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ResetPasswordForm } from './reset-password-form'

export const metadata: Metadata = { title: 'Set a new password' }

export default async function ResetPasswordPage() {
  // Verifying the recovery code establishes a session; without one there is
  // nothing to change the password of, so send them back to request a code.
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/forgot-password')

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-head">Set a new password</CardTitle>
        <CardDescription>
          Signing in elsewhere will be ended once you save.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResetPasswordForm />
      </CardContent>
    </Card>
  )
}
