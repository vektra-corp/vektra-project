import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { formatCurrency } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import { AlertTriangle, Clock, FileSignature, TrendingUp } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import {
  RevenueTile,
  RevenueTrend,
  totalsByCurrency,
  type RevenueMonth,
} from '@/components/dashboard/revenue-widgets'
import { Widget, WidgetEmpty } from '@/components/dashboard/widget'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Revenue' }

export default async function RevenuePage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  // Revenue follows the same manager boundary as the commercial documents it
  // aggregates; a member cannot read those, so they cannot read the rollup.
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  // revenue_summary is a materialized view and cannot carry RLS, so it is not
  // readable directly (00022). This function is the only way in, and it filters
  // to the caller's own organization.
  const { data: revenue } = await supabase.rpc('revenue_for_org', { p_months: 12 })

  const months: RevenueMonth[] = ((revenue ?? []) as Record<string, unknown>[]).map((row) => ({
    month: String(row.month),
    currency: String(row.currency),
    invoicedRevenue: Number(row.invoiced_revenue ?? 0),
    outstandingInvoices: Number(row.outstanding_invoices ?? 0),
    overdueInvoices: Number(row.overdue_invoices ?? 0),
    pipelineQuotations: Number(row.pipeline_quotations ?? 0),
    acceptedQuotations: Number(row.accepted_quotations ?? 0),
  }))

  // The org's own currency leads; other currencies are reported separately
  // rather than converted, because there is no rate to convert at.
  const currencies = [...new Set(months.map((month) => month.currency))]
  const primary = currencies.includes(auth.orgCurrency) ? auth.orgCurrency : currencies[0]

  const invoiced = totalsByCurrency(months, 'invoicedRevenue')
  const outstanding = totalsByCurrency(months, 'outstandingInvoices')
  const overdue = totalsByCurrency(months, 'overdueInvoices')
  const pipeline = totalsByCurrency(months, 'pipelineQuotations')
  const accepted = totalsByCurrency(months, 'acceptedQuotations')

  const [{ data: topContacts }] = await Promise.all([
    supabase
      .from('commercial_documents')
      .select('grand_total, currency, contact:contacts!commercial_documents_contact_id_fkey(contact_name, company_name)')
      .eq('organization_id', auth.orgId)
      .eq('doc_type', 'invoice')
      .eq('status', 'paid')
      .not('contact_id', 'is', null)
      .limit(500),
  ])

  const byContact = new Map<string, { name: string; currency: string; total: number }>()
  for (const doc of topContacts ?? []) {
    const contact = Array.isArray(doc.contact) ? doc.contact[0] : doc.contact
    if (!contact) continue
    const name = contact.company_name ?? contact.contact_name
    const key = `${name}::${doc.currency}`
    const entry = byContact.get(key) ?? { name, currency: doc.currency, total: 0 }
    entry.total += Number(doc.grand_total)
    byContact.set(key, entry)
  }

  const ranked = [...byContact.values()].sort((a, b) => b.total - a.total).slice(0, 8)

  // Quotations sent versus accepted, over the same window.
  const sentValue = [...pipeline.values()].reduce((sum, value) => sum + value, 0)
  const acceptedValue = [...accepted.values()].reduce((sum, value) => sum + value, 0)
  const conversion =
    sentValue + acceptedValue > 0
      ? Math.round((acceptedValue / (sentValue + acceptedValue)) * 100)
      : null

  if (!primary) {
    return (
      <>
        <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Revenue' }]} />
        <PageBody>
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <TrendingUp className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-base text-muted-foreground">Nothing to report yet.</p>
            <p className="pt-1 text-nav text-faint">
              Revenue appears once invoices and quotations have been issued.
            </p>
          </div>
        </PageBody>
      </>
    )
  }

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'Revenue' }]}
        meta={
          <Badge variant="secondary" shape="meta" className="ms-1">
            Last 12 months
          </Badge>
        }
      />

      <PageBody className="pt-1">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <RevenueTile
              label="Invoiced"
              value={invoiced.get(primary) ?? 0}
              currency={primary}
              locale={locale}
              icon={TrendingUp}
              tone="positive"
              caption="Paid invoices"
            />
            <RevenueTile
              label="Outstanding"
              value={outstanding.get(primary) ?? 0}
              currency={primary}
              locale={locale}
              icon={Clock}
              tone="warning"
              caption="Sent, not yet paid"
            />
            <RevenueTile
              label="Overdue"
              value={overdue.get(primary) ?? 0}
              currency={primary}
              locale={locale}
              icon={AlertTriangle}
              tone="critical"
              caption="Past the due date"
            />
            <RevenueTile
              label="Pipeline"
              value={pipeline.get(primary) ?? 0}
              currency={primary}
              locale={locale}
              icon={FileSignature}
              caption={conversion !== null ? `${conversion}% of quotes accepted` : 'Open quotations'}
            />
          </div>

          {currencies.length > 1 ? (
            <p className="rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-nav text-muted-foreground">
              Figures shown in {primary}. This organization also has documents in{' '}
              {currencies.filter((code) => code !== primary).join(', ')} — those are reported
              separately below rather than converted, since there is no exchange rate stored.
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <RevenueTrend months={months} currency={primary} locale={locale} />

            <Widget
              title="Revenue by client"
              className="h-full"
              action={{ label: 'Invoices', href: `/${params.orgSlug}/dashboard` }}
            >
              {ranked.length === 0 ? (
                <WidgetEmpty>No paid invoices yet.</WidgetEmpty>
              ) : (
                <ul className="divide-y divide-border-subtle overflow-y-auto">
                  {ranked.map((entry) => (
                    <li
                      key={`${entry.name}-${entry.currency}`}
                      className="flex items-center gap-3 px-4 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-base">{entry.name}</span>
                      <span className="text-base tabular-nums text-muted-foreground">
                        {formatCurrency(entry.total, entry.currency, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Widget>
          </div>

          {currencies.length > 1 ? (
            <Widget title="Other currencies">
              <ul className="divide-y divide-border-subtle">
                {currencies
                  .filter((code) => code !== primary)
                  .map((code) => (
                    <li key={code} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="label-meta w-12 text-faint">{code}</span>
                      <span className="flex-1 text-base text-muted-foreground">Invoiced</span>
                      <span className="text-base tabular-nums">
                        {formatCurrency(invoiced.get(code) ?? 0, code, locale)}
                      </span>
                    </li>
                  ))}
              </ul>
            </Widget>
          ) : null}

          <p className="text-nav text-faint">
            Figures are rebuilt hourly by a background job, so very recent changes may not appear
            yet.{' '}
            <Link href={`/${params.orgSlug}/dashboard`} className="text-primary hover:underline">
              Back to dashboard
            </Link>
          </p>
        </div>
      </PageBody>
    </>
  )
}
