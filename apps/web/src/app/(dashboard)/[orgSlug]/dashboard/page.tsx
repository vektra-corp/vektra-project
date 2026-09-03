import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * Dashboard shell.
 *
 * Phase 0 renders counts only. The configurable grid and the widget catalogue
 * (§19.10) arrive in V1; this page is deliberately a placeholder that proves the
 * tenant context, RLS reads and layout all work end to end.
 */
export default async function DashboardPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  const t = await getTranslations()
  const supabase = createClient()

  const [projects, openTasks, members] = await Promise.all([
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .eq('status', 'active'),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId)
      .not('status', 'in', '(done,cancelled)'),
    supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId),
  ])

  const stats = [
    { label: t('nav.projects'), value: projects.count ?? 0 },
    { label: t('nav.tasks'), value: openTasks.count ?? 0 },
    { label: t('nav.members'), value: members.count ?? 0 },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('nav.dashboard')}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {auth.email} · {auth.orgRole}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next up</CardTitle>
          <CardDescription>
            Projects, the Kanban board and the task report land in the MVP phase.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The foundations are in place: tenancy, RLS, the event bus, billing and
          the auth flow.
        </CardContent>
      </Card>
    </div>
  )
}
