import { Badge } from '@pm/ui'
import { subHours } from 'date-fns'
import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata: Metadata = { title: 'System health' }

interface Check {
  label: string
  value: string | number
  state: 'ok' | 'warn' | 'fail'
  detail: string
}

function StateBadge({ state }: { state: Check['state'] }) {
  const variant = state === 'ok' ? 'success' : state === 'warn' ? 'warning' : 'destructive'
  const label = state === 'ok' ? 'OK' : state === 'warn' ? 'Watch' : 'Fail'
  return (
    <Badge variant={variant} shape="meta">
      {label}
    </Badge>
  )
}

/**
 * Operational readouts.
 *
 * Each row states what it measured and what would be wrong — a dashboard that
 * shows a number without saying which direction is bad cannot be acted on.
 * Configuration presence is reported, never the values themselves.
 */
export default async function SystemHealthPage() {
  await requireAdmin()
  const supabase = createAdminClient()

  const lastHour = subHours(new Date(), 1).toISOString()
  const lastDay = subHours(new Date(), 24).toISOString()

  const [
    { count: unprocessedEvents },
    { count: recentEvents },
    { count: pendingEmails },
    { count: failedRuns },
    { count: activeOrgs },
    { count: suspendedOrgs },
  ] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('processed', false),
    supabase.from('events').select('id', { count: 'exact', head: true }).gte('created_at', lastHour),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('emailed_at', null)
      .gte('created_at', lastDay),
    supabase
      .from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('started_at', lastDay),
    supabase
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'suspended'),
  ])

  const checks: Check[] = [
    {
      label: 'Unprocessed events',
      value: unprocessedEvents ?? 0,
      // The event bus feeds workflows and integrations; a growing backlog means
      // the consumer has stopped, which is silent otherwise.
      state: (unprocessedEvents ?? 0) > 1000 ? 'fail' : (unprocessedEvents ?? 0) > 100 ? 'warn' : 'ok',
      detail: 'Backlog on the internal event bus. Over 100 suggests a stalled consumer.',
    },
    {
      label: 'Events in the last hour',
      value: recentEvents ?? 0,
      state: 'ok',
      detail: 'Write throughput across all tenants.',
    },
    {
      label: 'Emails awaiting delivery',
      value: pendingEmails ?? 0,
      state: (pendingEmails ?? 0) > 500 ? 'warn' : 'ok',
      detail: 'Notifications from the last 24h with no send recorded yet.',
    },
    {
      label: 'Failed workflow runs (24h)',
      value: failedRuns ?? 0,
      state: (failedRuns ?? 0) > 20 ? 'fail' : (failedRuns ?? 0) > 0 ? 'warn' : 'ok',
      detail: 'Runs that ended in the failed state.',
    },
    {
      label: 'Active tenants',
      value: activeOrgs ?? 0,
      state: 'ok',
      detail: 'Organizations with status active.',
    },
    {
      label: 'Suspended tenants',
      value: suspendedOrgs ?? 0,
      state: (suspendedOrgs ?? 0) > 0 ? 'warn' : 'ok',
      detail: 'Usually the result of a failed payment.',
    },
  ]

  // Presence only. The values are secrets and must never reach a rendered page.
  const configuration: { label: string; configured: boolean }[] = [
    { label: 'Razorpay key secret', configured: Boolean(process.env.RAZORPAY_KEY_SECRET) },
    {
      label: 'Razorpay webhook secret',
      configured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    },
    { label: 'PayPal client secret', configured: Boolean(process.env.PAYPAL_CLIENT_SECRET) },
    { label: 'PayPal webhook id', configured: Boolean(process.env.PAYPAL_WEBHOOK_ID) },
    { label: 'Resend API key', configured: Boolean(process.env.RESEND_API_KEY) },
    { label: 'Inngest signing key', configured: Boolean(process.env.INNGEST_SIGNING_KEY) },
    { label: 'Upstash Redis', configured: Boolean(process.env.UPSTASH_REDIS_REST_URL) },
  ]

  return (
    <>
      <AdminHeader title="System health" description="Backlogs, failures and configuration presence." />

      <AdminBody>
        <div className="max-w-3xl space-y-4">
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {checks.map((check) => (
              <li key={check.label} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium">{check.label}</p>
                  <p className="pt-1 text-xs text-muted-foreground">{check.detail}</p>
                </div>
                <span className="font-mono text-sm tabular-nums">{check.value}</span>
                <StateBadge state={check.state} />
              </li>
            ))}
          </ul>

          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <div className="border-b border-border-subtle px-4 py-3">
              <h2 className="label-meta text-faint">Configuration</h2>
              <p className="pt-1.5 text-xs text-muted-foreground">
                Presence only — values are never rendered.
              </p>
            </div>
            <ul className="divide-y divide-border-subtle">
              {configuration.map((entry) => (
                <li key={entry.label} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-[13px]">{entry.label}</span>
                  <Badge variant={entry.configured ? 'success' : 'warning'} shape="meta">
                    {entry.configured ? 'Set' : 'Missing'}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </AdminBody>
    </>
  )
}
