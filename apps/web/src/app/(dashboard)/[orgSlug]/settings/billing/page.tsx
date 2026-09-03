import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { PLAN_LIMITS, type PlanName } from '@pm/shared/constants'
import { formatDate } from '@pm/shared/utils'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { startCheckout, openBillingPortal } from './actions'

export const metadata: Metadata = { title: 'Billing' }

export default async function BillingPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)

  // Billing is owner and admin only (§8 permission matrix).
  if (!ORG_ADMIN_ROLES.includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const [{ data: organization }, { data: plans }, { data: usage }, seatCount] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, status, trial_ends_at, stripe_customer_id, plan:plans(name, display_name)')
      .eq('id', auth.orgId)
      .maybeSingle(),
    supabase
      .from('plans')
      .select('id, name, display_name, stripe_price_id_monthly')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('usage_counters')
      .select('metric, current_value, limit_value')
      .eq('organization_id', auth.orgId),
    supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId),
  ])

  const planRow = Array.isArray(organization?.plan) ? organization?.plan[0] : organization?.plan
  const currentPlan = (planRow?.name ?? 'starter') as PlanName
  const limits = PLAN_LIMITS[currentPlan]

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription and see what your plan includes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardDescription>Current plan</CardDescription>
              <CardTitle className="flex items-center gap-2">
                {planRow?.display_name ?? 'Starter'}
                <Badge variant={organization?.status === 'active' ? 'secondary' : 'outline'}>
                  {organization?.status}
                </Badge>
              </CardTitle>
            </div>
            {organization?.stripe_customer_id ? (
              <form action={openBillingPortal}>
                <Button type="submit" variant="outline">
                  Manage subscription
                </Button>
              </form>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {organization?.trial_ends_at && organization.status === 'trial' ? (
            <p className="text-muted-foreground">
              Trial ends{' '}
              {formatDate(organization.trial_ends_at, {
                locale: 'en',
                dateFormat: 'YYYY-MM-DD',
              })}
            </p>
          ) : null}
          <p className="text-muted-foreground">
            {seatCount.count ?? 0} {seatCount.count === 1 ? 'seat' : 'seats'} in use
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Included in your plan</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Limit label="Projects" value={limits.projects} />
            <Limit label="Portal users" value={limits.portal_users} />
            <Limit label="Workflows per workspace" value={limits.workflows_per_workspace} />
            <Limit label="Workflow runs per month" value={limits.workflow_runs_per_month} />
            <Feature label="Gantt timeline" enabled={limits.gantt} />
            <Feature label="Commercial documents" enabled={limits.commercial} />
            <Feature label="Custom fields" enabled={limits.custom_fields} />
            <Feature label="Custom roles" enabled={limits.custom_roles} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change plan</CardTitle>
          <CardDescription>Billed per seat, per month.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {(plans ?? []).map((plan) => (
            <form key={plan.id} action={startCheckout}>
              <input type="hidden" name="plan_id" value={plan.id} />
              <Button
                type="submit"
                variant={plan.name === currentPlan ? 'secondary' : 'outline'}
                className="w-full"
                disabled={plan.name === currentPlan || !plan.stripe_price_id_monthly}
              >
                {plan.name === currentPlan ? `${plan.display_name} (current)` : plan.display_name}
              </Button>
            </form>
          ))}
        </CardContent>
      </Card>

      {usage && usage.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage this period</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {usage.map((row) => (
                <div key={row.metric} className="flex justify-between text-sm">
                  <dt className="text-muted-foreground">{row.metric}</dt>
                  <dd className="tabular-nums">
                    {row.current_value}
                    {row.limit_value ? ` / ${row.limit_value}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function Limit({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value === null ? 'Unlimited' : value.toLocaleString()}</dd>
    </div>
  )
}

function Feature({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={enabled ? '' : 'text-muted-foreground'}>{enabled ? 'Included' : 'Not included'}</dd>
    </div>
  )
}
