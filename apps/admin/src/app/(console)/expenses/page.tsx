import { formatDate } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import { AdminBody, AdminHeader } from '@/components/admin-shell'
import { shortMoney } from '@/components/chart-format'
import { BarList, StatTile } from '@/components/charts'
import { canWrite, requireAdmin } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { lastMonths, monthKey } from '../dashboard-shared'
import { EXPENSE_CATEGORY_LABEL as CATEGORY_LABEL } from './constants'
import { ExpenseForm, ExpenseRowActions } from './expense-controls'

export const metadata: Metadata = { title: 'Expenses' }

/**
 * Operating costs.
 *
 * This is the data source the global dashboard's Expense figure reads. It is
 * entered by hand because nothing in the product generates it — there is no
 * accounting integration, and deriving a cost from gateway fees alone would
 * cover one category and silently report it as the whole.
 */
export default async function ExpensesPage() {
  const admin = await requireAdmin()
  const readOnly = !canWrite(admin.role)
  const supabase = createAdminClient()

  const months = lastMonths(12)
  const since = months[0]?.start.slice(0, 10) ?? ''

  const { data: expenses } = await supabase
    .from('platform_expenses')
    .select('id, category, description, amount_minor, currency, incurred_on, notes, recorded_by_email')
    .order('incurred_on', { ascending: false })
    .limit(200)

  const rows = expenses ?? []
  const recent = rows.filter((r) => r.incurred_on >= since)

  // Per currency, never across — the same rule the overview follows.
  const byCurrency = new Map<string, number>()
  for (const r of recent) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.amount_minor)
  const reporting = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'INR'

  const byCategory = new Map<string, number>()
  for (const r of recent) {
    if (r.currency !== reporting) continue
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.amount_minor)
  }

  const thisMonth = monthKey(new Date().toISOString())
  const thisMonthTotal = recent
    .filter((r) => r.currency === reporting && monthKey(r.incurred_on) === thisMonth)
    .reduce((sum, r) => sum + r.amount_minor, 0)

  return (
    <>
      <AdminHeader
        title="Expenses"
        description={`Operating costs. Totals shown in ${reporting}; other currencies are listed but never added to it.`}
      />

      <AdminBody>
        <div className="max-w-3xl space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Last 12 months"
              value={shortMoney(byCurrency.get(reporting) ?? 0, reporting)}
            />
            <StatTile label="This month" value={shortMoney(thisMonthTotal, reporting)} />
            <StatTile label="Entries" value={String(rows.length)} sub="Most recent 200" />
          </div>

          <BarList
            title={`By category · last 12 months (${reporting})`}
            data={[...byCategory.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([category, value]) => ({
                label: CATEGORY_LABEL[category] ?? category,
                value,
                display: shortMoney(value, reporting),
              }))}
            empty="Nothing recorded yet."
          />

          {readOnly ? null : <ExpenseForm />}

          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {rows.length === 0 ? (
              <li className="text-muted-foreground px-4 py-10 text-center text-sm">
                No expenses recorded. The dashboard&rsquo;s Expense and Margin tiles stay at zero
                until something is entered here.
              </li>
            ) : (
              rows.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" shape="meta">
                        {CATEGORY_LABEL[r.category] ?? r.category}
                      </Badge>
                      <span className="text-[13px] font-medium">{r.description}</span>
                    </div>
                    <p className="label-meta text-faint pt-1.5">
                      {formatDate(r.incurred_on, { locale: 'en', dateFormat: 'YYYY-MM-DD' })}
                      <span className="px-1.5 opacity-50">·</span>
                      {r.recorded_by_email}
                      {r.notes ? <span className="ps-1.5 opacity-70">· {r.notes}</span> : null}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] tabular-nums">
                    {shortMoney(r.amount_minor, r.currency)}
                  </span>
                  {readOnly ? null : <ExpenseRowActions id={r.id} description={r.description} />}
                </li>
              ))
            )}
          </ul>
        </div>
      </AdminBody>
    </>
  )
}
