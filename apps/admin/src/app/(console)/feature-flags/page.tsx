import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { FlagToggle } from './flag-toggle'

export const metadata: Metadata = { title: 'Feature flags' }

/**
 * Feature flags.
 *
 * The master switch is toggled here; per-plan, per-org and percentage rules live
 * in `rules` and are evaluated by `feature_enabled()` in the database, so the
 * customer app never reads this table directly.
 */
export default async function FeatureFlagsPage() {
  const admin = await requireAdmin()
  const readOnly = !canWrite(admin.role)
  const supabase = createAdminClient()

  const { data: flags } = await supabase
    .from('feature_flags')
    .select('id, key, description, is_enabled, rules, updated_at')
    .order('key')

  return (
    <>
      <AdminHeader
        title="Feature flags"
        description="The master switch. Targeting rules are evaluated in the database."
      />

      <AdminBody>
        <ul className="max-w-3xl divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          {!flags?.length ? (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground">
              No flags defined.
            </li>
          ) : (
            flags.map((flag) => {
              const rules = Array.isArray(flag.rules) ? flag.rules : []
              return (
                <li key={flag.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      flag.is_enabled ? 'bg-success' : 'bg-faint'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px]">{flag.key}</p>
                    {flag.description ? (
                      <p className="pt-1 text-[13px] text-muted-foreground">{flag.description}</p>
                    ) : null}
                  </div>
                  {rules.length > 0 ? (
                    <Badge variant="secondary" shape="meta">
                      {rules.length} rule{rules.length === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                  <FlagToggle id={flag.id} isEnabled={flag.is_enabled} disabled={readOnly} />
                </li>
              )
            })
          )}
        </ul>
      </AdminBody>
    </>
  )
}
