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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <span
            className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-destructive to-priority-high shadow-card"
            aria-hidden
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
              <path
                d="M12 3.5 5 6.5v5c0 4.2 2.9 7.9 7 9 4.1-1.1 7-4.8 7-9v-5l-7-3Z"
                stroke="white"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <CardTitle className="text-lg">Platform admin</CardTitle>
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
