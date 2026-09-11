import { formatCurrency, formatDate } from '@pm/shared/utils'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pm/ui'

/**
 * Past payments, and the invoice for each.
 *
 * Every attempt is listed, not just the successful ones: a failed charge is the
 * row an owner most needs when they are working out why access changed, and
 * hiding it would make this table reassuring and useless at the same moment.
 *
 * The invoice link is a route, not a storage URL — the bucket is private and
 * the route is what checks the role before minting a signed URL.
 */

export interface PaymentRow {
  id: string
  status: string
  currency: string
  amountMinor: number
  method: string | null
  createdAt: string
  capturedAt: string | null
  errorDescription: string | null
  invoice: { id: string; number: string; ready: boolean } | null
}

const STATUS_LABEL: Record<string, string> = {
  captured: 'Paid',
  failed: 'Failed',
  refunded: 'Refunded',
  initiated: 'Started',
  authorized: 'Authorised',
  cancelled: 'Cancelled',
}

export function BillingHistory({
  orgSlug,
  payments,
  locale,
  dateFormat,
}: {
  orgSlug: string
  payments: PaymentRow[]
  locale: string
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD.MM.YYYY' | 'DD-MM-YYYY'
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Billing history</CardTitle>
        <CardDescription>
          Every payment attempt on this organization, with its tax invoice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-muted-foreground text-ui">No payments yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-ui">
              <thead>
                <tr className="text-muted-foreground text-left text-xs uppercase">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Amount</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  <th className="py-2 font-medium">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-border-subtle divide-y">
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {formatDate(payment.capturedAt ?? payment.createdAt, { locale, dateFormat })}
                    </td>
                    <td className="py-2.5 pr-4 tabular-nums whitespace-nowrap">
                      {formatCurrency(payment.amountMinor / 100, payment.currency, locale)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant={payment.status === 'captured' ? 'secondary' : 'outline'}>
                        {STATUS_LABEL[payment.status] ?? payment.status}
                      </Badge>
                      {payment.errorDescription ? (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {payment.errorDescription}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground py-2.5 pr-4">{payment.method ?? '—'}</td>
                    <td className="py-2.5">
                      {payment.invoice?.ready ? (
                        <a
                          className="underline underline-offset-2"
                          href={`/${orgSlug}/settings/billing/invoices/${payment.invoice.id}`}
                        >
                          {payment.invoice.number}
                        </a>
                      ) : payment.invoice ? (
                        <span className="text-muted-foreground">Preparing…</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
