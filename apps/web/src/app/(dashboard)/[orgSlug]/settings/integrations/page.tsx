import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { parseSlackConfig } from '@pm/shared/constants'
import { formatRelativeTime } from '@pm/shared/utils'
import { Alert, AlertDescription, Badge } from '@pm/ui'
import { AlertCircle, Check } from 'lucide-react'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { SlackPanel } from './slack-panel'

export const metadata: Metadata = { title: 'Integrations' }

const CALLBACK_MESSAGE: Record<string, { text: string; ok: boolean }> = {
  connected: { text: 'Slack connected. Choose a channel below to start posting.', ok: true },
  cancelled: { text: 'Slack connection cancelled.', ok: false },
  invalid_state: {
    text: 'That connection link was not valid. Start again from this page.',
    ok: false,
  },
  forbidden: { text: 'You need to be an admin of this organization to connect Slack.', ok: false },
  failed: { text: 'Slack did not complete the connection. Try again.', ok: false },
  not_configured: { text: 'Slack is not configured on this deployment.', ok: false },
}

/**
 * Integrations (§6.6, §12).
 *
 * Admin-only: connecting one gives a third party a live feed of the
 * organisation's activity.
 *
 * The recent-deliveries list matters more than it looks. Without it a failing
 * integration is invisible — the channel simply goes quiet, and nobody can tell
 * whether that means nothing happened or nothing was delivered.
 */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string }
  searchParams: { slack?: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const [{ data: integration }, { data: deliveries }] = await Promise.all([
    supabase
      .from('integrations')
      .select('id, provider, status, config, last_error')
      .eq('organization_id', auth.orgId)
      .eq('provider', 'slack')
      .maybeSingle(),
    supabase
      .from('integration_deliveries')
      .select('id, event_type, status, detail, created_at')
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  const notice = searchParams.slack ? CALLBACK_MESSAGE[searchParams.slack] : undefined
  const config = parseSlackConfig(integration?.config)

  // Presence of the client id is all the page needs to know; the secret never
  // leaves the server and is not checked here.
  const configured = Boolean(process.env.SLACK_CLIENT_ID)

  return (
    <PageBody className="pt-4">
      <div className="max-w-3xl space-y-5 pb-10">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Integrations</h1>
          <p className="pt-1 text-[13px] text-muted-foreground">
            Send activity from this organization to the tools your team already uses.
          </p>
        </div>

        {notice ? (
          <Alert variant={notice.ok ? 'success' : 'destructive'}>
            {notice.ok ? <Check aria-hidden /> : <AlertCircle aria-hidden />}
            <AlertDescription>{notice.text}</AlertDescription>
          </Alert>
        ) : null}

        <SlackPanel
          orgSlug={params.orgSlug}
          connected={Boolean(integration)}
          config={config}
          status={integration?.status ?? null}
          lastError={integration?.last_error ?? null}
          configured={configured}
        />

        {deliveries && deliveries.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <header className="border-b border-border-subtle px-5 py-3">
              <h2 className="text-sm font-semibold">Recent deliveries</h2>
            </header>
            <ul className="divide-y divide-border-subtle">
              {deliveries.map((delivery) => (
                <li
                  key={delivery.id}
                  className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13px]"
                >
                  <Badge
                    variant={
                      delivery.status === 'delivered'
                        ? 'success'
                        : delivery.status === 'skipped'
                          ? 'secondary'
                          : 'destructive'
                    }
                    shape="meta"
                  >
                    {delivery.status}
                  </Badge>
                  <code className="font-mono text-[11px] text-muted-foreground">
                    {delivery.event_type}
                  </code>
                  {delivery.detail ? (
                    <span className="text-faint">{delivery.detail}</span>
                  ) : null}
                  <span className="ms-auto text-faint">
                    {formatRelativeTime(delivery.created_at, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PageBody>
  )
}
