import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { featureEnabled, limitFor } from '@pm/shared/billing'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'
import type { Metadata } from 'next'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Billing' }

/**
 * What this organization is on, and what that includes.
 *
 * Everything here reads `auth.entitlements`, resolved by `org_entitlements()`
 * rather than from `organizations.plan_id` — which is no longer the authority
 * for anything, and which a tenant can no longer write (migration 00037).
 *
 * Checkout controls are deliberately absent until the Razorpay and PayPal
 * paths land. A button that cannot complete a payment is worse than no button.
 */
export default async function BillingPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)

  // Billing is owner and admin only (§8 permission matrix).
  if (!ORG_ADMIN_ROLES.includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const [{ data: usage }, seatCount] = await Promise.all([
    supabase
      .from('usage_counters')
      .select('metric, current_value')
      .eq('organization_id', auth.orgId),
    supabase
      .from('org_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', auth.orgId),
  ])

  const { entitlements } = auth
  const seats = seatCount.count ?? 0

  return (
    <SettingsPanel>
      <div className="space-y-6">
        <div>
          <h1 className="text-head font-semibold">Billing</h1>
          <p className="text-muted-foreground text-ui">
            Your current plan and what it includes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardDescription>Current plan</CardDescription>
                <CardTitle className="flex items-center gap-2">
                  {entitlements.planDisplayName}
                  <Badge variant={auth.orgStatus === 'active' ? 'secondary' : 'outline'}>
                    {auth.orgStatus}
                  </Badge>
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-ui">
            <SourceNote source={entitlements.source} />
            <p className="text-muted-foreground">
              {seats} {seats === 1 ? 'seat' : 'seats'} in use
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Included in your plan</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Limit label="Projects" value={limitFor(entitlements, 'projects')} />
              <Limit label="Portal users" value={limitFor(entitlements, 'portal_users')} />
              <Limit
                label="Workflows per workspace"
                value={limitFor(entitlements, 'workflows_per_workspace')}
              />
              <Limit
                label="Workflow runs per month"
                value={limitFor(entitlements, 'workflow_runs_per_month')}
              />
              <Feature label="Gantt timeline" enabled={featureEnabled(entitlements, 'gantt')} />
              <Feature
                label="Commercial documents"
                enabled={featureEnabled(entitlements, 'commercial')}
              />
              <Feature
                label="Custom fields"
                enabled={featureEnabled(entitlements, 'custom_fields')}
              />
              <Feature
                label="Custom roles"
                enabled={featureEnabled(entitlements, 'custom_roles')}
              />
            </dl>
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
                  <div key={row.metric} className="flex justify-between text-ui">
                    <dt className="text-muted-foreground">{row.metric}</dt>
                    <dd className="tabular-nums">{row.current_value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </SettingsPanel>
  )
}

/** Why this org has the plan it has. A comped or trial plan should say so. */
function SourceNote({ source }: { source: string }) {
  if (source === 'early_access') {
    return <p className="text-muted-foreground">Early Access — granted, no charge.</p>
  }
  if (source === 'comp') {
    return <p className="text-muted-foreground">Complimentary access — no charge.</p>
  }
  if (source === 'trial') {
    return <p className="text-muted-foreground">Trial.</p>
  }
  if (source === 'starter_default') {
    return <p className="text-muted-foreground">Free plan.</p>
  }
  return null
}

function Limit({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex justify-between text-ui">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value === null ? 'Unlimited' : value.toLocaleString()}</dd>
    </div>
  )
}

function Feature({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex justify-between text-ui">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={enabled ? '' : 'text-muted-foreground'}>
        {enabled ? 'Included' : 'Not included'}
      </dd>
    </div>
  )
}
