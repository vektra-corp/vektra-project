import { renderToBuffer } from '@react-pdf/renderer'
import { BillingInvoicePdf, type BillingInvoiceData } from './billing-invoice'

/**
 * Render an invoice to a PDF buffer.
 *
 * Exists as its own module so the job that issues invoices can stay a `.ts`
 * file. That is not cosmetic: the service-role client is lint-restricted out of
 * `.tsx` (apps/web/.eslintrc.js), on the grounds that a component reaching for
 * an RLS-bypassing client is a mistake. Keeping JSX and database access in
 * separate files satisfies the rule without weakening it — this module touches
 * no database, and the job renders no JSX.
 */
export async function renderInvoicePdf(data: BillingInvoiceData): Promise<Buffer> {
  return renderToBuffer(<BillingInvoicePdf data={data} />)
}

export type { BillingInvoiceData }
