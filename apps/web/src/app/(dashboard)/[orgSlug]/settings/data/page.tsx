import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { TRANSFER_ENTITIES, TRANSFER_ENTITY_LABELS } from '@pm/shared/constants'
import { formatRelativeTime } from '@pm/shared/utils'
import { Badge, Button } from '@pm/ui'
import { Download } from 'lucide-react'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { SettingsPanel } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { ImportPanel } from './import-panel'

export const metadata: Metadata = { title: 'Import and export' }

/**
 * Import and export (§20 Phase 2, §6.7).
 *
 * Manager-gated: an export is a bulk read of the organisation's data, and an
 * import writes records everyone else will see.
 *
 * The history list is not decoration — it is the only way to answer "who
 * exported the customer list, and when", which is exactly the question that
 * gets asked after the fact.
 */
export default async function DataPage({ params }: { params: { orgSlug: string } }) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const [{ data: projects }, { data: jobs }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name')
      .eq('organization_id', auth.orgId)
      .neq('status', 'archived')
      .order('name'),
    supabase
      .from('import_export_jobs')
      .select('id, type, entity_type, status, result, created_at')
      .eq('organization_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(15),
  ])

  return (
    <SettingsPanel>
      <div className="space-y-5 pb-10">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Import and export</h1>
          <p className="pt-1 text-base text-muted-foreground">
            Move data in and out as CSV. Exports contain only what you can already see.
          </p>
        </div>

        <section className="rounded-lg border border-border bg-surface shadow-card">
          <header className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-ui font-semibold">Export</h2>
            <p className="pt-1 text-base text-muted-foreground">
              Downloads immediately. Opens in Excel, Numbers or Sheets.
            </p>
          </header>
          <div className="flex flex-wrap gap-2 px-5 py-5">
            {TRANSFER_ENTITIES.map((entity) => (
              <Button key={entity} asChild variant="outline" size="sm">
                {/*
                  A plain link, not fetch: the browser's own download handling
                  gets the filename from Content-Disposition and never holds the
                  file in memory.
                */}
                <a
                  href={`/api/export?org=${encodeURIComponent(params.orgSlug)}&entity=${entity}`}
                  download
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  {TRANSFER_ENTITY_LABELS[entity]}
                </a>
              </Button>
            ))}
          </div>
        </section>

        <ImportPanel orgSlug={params.orgSlug} projects={projects ?? []} />

        {jobs && jobs.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <header className="border-b border-border-subtle px-5 py-3">
              <h2 className="text-ui font-semibold">History</h2>
            </header>
            <ul className="divide-y divide-border-subtle">
              {jobs.map((job) => {
                const result = (job.result ?? {}) as {
                  rows_processed?: number
                  rows_failed?: number
                  truncated?: boolean
                }
                return (
                  <li
                    key={job.id}
                    className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-base"
                  >
                    <Badge
                      variant={
                        job.status === 'completed'
                          ? 'success'
                          : job.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                      }
                      shape="meta"
                    >
                      {job.status}
                    </Badge>
                    <span className="capitalize">{job.type}</span>
                    <span className="text-muted-foreground">{job.entity_type}</span>
                    {typeof result.rows_processed === 'number' ? (
                      <span className="text-faint">
                        {result.rows_processed} row{result.rows_processed === 1 ? '' : 's'}
                        {result.rows_failed ? `, ${result.rows_failed} skipped` : ''}
                        {result.truncated ? ' (truncated)' : ''}
                      </span>
                    ) : null}
                    <span className="ms-auto text-faint">
                      {formatRelativeTime(job.created_at, locale)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </SettingsPanel>
  )
}
