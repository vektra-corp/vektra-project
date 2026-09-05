import { ORG_ADMIN_ROLES } from '@pm/auth/constants'
import { formatDateTime } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { AuditFilters, AuditPager } from './audit-filters'

export const metadata: Metadata = { title: 'Audit log' }

const PAGE_SIZE = 100

const ACTOR_VARIANT: Record<string, 'secondary' | 'warning' | 'outline'> = {
  user: 'secondary',
  admin: 'warning',
  system: 'outline',
  workflow: 'outline',
  integration: 'outline',
}

/** Turn `invoice.approved` into `Invoice approved`. */
function readableAction(action: string): string {
  const text = action.replace(/[._]/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The organisation's own audit trail (§13.11).
 *
 * The admin console has had a cross-tenant view of this for a while; a customer
 * had no way to see their own. Access is owner/admin, matching the RLS policy —
 * the page check is for a tidy UI, the policy is what actually enforces it.
 *
 * Read-only by construction: `audit_logs` has no UPDATE or DELETE policy for
 * anyone, so there is nothing to expose here beyond reading.
 */
export default async function AuditLogPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string }
  searchParams: { actor?: string; resource?: string; page?: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_ADMIN_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const page = Math.max(0, Number(searchParams.page ?? 0) || 0)
  const from = page * PAGE_SIZE

  let query = supabase
    .from('audit_logs')
    .select(
      `id, action, actor_type, resource_type, resource_id, changes, created_at,
       actor:profiles!audit_logs_actor_id_fkey(full_name, avatar_url)`,
    )
    .eq('organization_id', auth.orgId)
    .order('created_at', { ascending: false })
    // One extra row is fetched to answer "is there another page" without a
    // count query, which on an append-only table is needlessly expensive.
    .range(from, from + PAGE_SIZE)

  if (searchParams.actor) query = query.eq('actor_type', searchParams.actor)
  if (searchParams.resource) query = query.eq('resource_type', searchParams.resource)

  const { data } = await query
  const hasMore = (data?.length ?? 0) > PAGE_SIZE
  const entries = (data ?? []).slice(0, PAGE_SIZE)

  // The distinct resource types actually present, so the filter never offers an
  // option that would return nothing.
  const { data: resourceRows } = await supabase
    .from('audit_logs')
    .select('resource_type')
    .eq('organization_id', auth.orgId)
    .limit(500)

  const resourceTypes = [...new Set((resourceRows ?? []).map((row) => row.resource_type))].sort()

  return (
    <PageBody className="pt-4">
      <div className="space-y-4 pb-10">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Audit log</h1>
          <p className="pt-1 text-base text-muted-foreground">
            Every sensitive action in this organization. Entries cannot be edited or
            removed, including by an owner.
          </p>
        </div>

        <AuditFilters
          orgSlug={params.orgSlug}
          resourceTypes={resourceTypes}
          actor={searchParams.actor ?? ''}
          resource={searchParams.resource ?? ''}
        />

        {entries.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-base text-muted-foreground">
            Nothing recorded yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="label-meta px-4 py-2.5 text-start text-faint">When</th>
                  <th className="label-meta px-4 py-2.5 text-start text-faint">Actor</th>
                  <th className="label-meta px-4 py-2.5 text-start text-faint">Action</th>
                  <th className="label-meta px-4 py-2.5 text-start text-faint">Resource</th>
                  <th className="label-meta px-4 py-2.5 text-start text-faint">Changes</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const actor = Array.isArray(entry.actor) ? entry.actor[0] : entry.actor
                  const changed = entry.changes && typeof entry.changes === 'object'
                    ? Object.keys(entry.changes as Record<string, unknown>)
                    : []

                  return (
                    <tr key={entry.id} className="border-b border-border-subtle last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                        {formatDateTime(entry.created_at, {
                          locale,
                          dateFormat: 'YYYY-MM-DD',
                          timeFormat: '24h',
                        })}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={ACTOR_VARIANT[entry.actor_type] ?? 'outline'} shape="meta">
                          {entry.actor_type}
                        </Badge>
                        {actor?.full_name ? (
                          <span className="ps-2 text-muted-foreground">{actor.full_name}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">{readableAction(entry.action)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {entry.resource_type}
                        {entry.resource_id ? (
                          <code className="ps-1.5 font-mono text-[11px] text-faint">
                            {entry.resource_id.slice(0, 8)}
                          </code>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-faint">
                        {changed.length > 0 ? changed.join(', ') : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <AuditPager
          orgSlug={params.orgSlug}
          page={page}
          hasMore={hasMore}
          actor={searchParams.actor ?? ''}
          resource={searchParams.resource ?? ''}
        />
      </div>
    </PageBody>
  )
}
