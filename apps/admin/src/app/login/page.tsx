import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminContext } from '@/lib/auth'
import { AdminLoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function AdminLoginPage() {
  const admin = await getAdminContext()
  if (admin) redirect('/orgs')

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Platform admin</CardTitle>
          <CardDescription>
            Restricted console. Access is logged and attributed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdminLoginForm />
        </CardContent>
      </Card>
    </div>
  )
}
