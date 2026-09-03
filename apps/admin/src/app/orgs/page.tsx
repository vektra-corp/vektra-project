import { formatDate } from '@pm/shared/utils'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSignOut } from './sign-out'

export const metadata: Metadata = { title: 'Organizations' }

/**
 * Tenant list.
 *
 * Reads through the service-role client, so it deliberately selects only the
 * operational columns an operator needs — never customer content.
 */
export default async function OrgsPage() {
  const admin = await requireAdmin()
  const supabase = createAdminClient()

  const { data: organizations } = await supabase
    .from('organizations')
    .select('id, name, slug, status, created_at, trial_ends_at, plan:plans(display_name)')
    .order('created_at', { ascending: false })
    .limit(100)

  const statusVariant = (status: string) =>
    status === 'active'
      ? 'secondary'
      : status === 'trial'
        ? 'outline'
        : ('destructive' as const)

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {admin.email} · {admin.role}
          </p>
        </div>
        <AdminSignOut />
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All tenants</CardTitle>
          <CardDescription>{organizations?.length ?? 0} shown, newest first</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Name</th>
                  <th className="px-6 py-3 font-medium">Slug</th>
                  <th className="px-6 py-3 font-medium">Plan</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {(organizations ?? []).map((org) => {
                  const plan = Array.isArray(org.plan) ? org.plan[0] : org.plan
                  return (
                    <tr key={org.id} className="border-b last:border-0">
                      <td className="px-6 py-3 font-medium">{org.name}</td>
                      <td className="px-6 py-3 text-muted-foreground">{org.slug}</td>
                      <td className="px-6 py-3">{plan?.display_name ?? '—'}</td>
                      <td className="px-6 py-3">
                        <Badge variant={statusVariant(org.status)}>{org.status}</Badge>
                      </td>
                      <td className="px-6 py-3 tabular-nums text-muted-foreground">
                        {formatDate(org.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
                      </td>
                    </tr>
                  )
                })}
                {!organizations?.length ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                      No organizations yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
