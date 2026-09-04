import type { CommercialDocType } from '@pm/shared/constants'

/**
 * URL segment ↔ doc_type mapping.
 *
 * The database stores singular snake_case; the URL reads better plural. Keeping
 * the map in one place means neither has to bend to the other.
 */
export const SEGMENT_TO_DOC_TYPE: Record<string, CommercialDocType> = {
  quotations: 'quotation',
  invoices: 'invoice',
  'sales-orders': 'sales_order',
  'purchase-orders': 'purchase_order',
  bills: 'bill',
}

export const DOC_TYPE_TO_SEGMENT: Record<CommercialDocType, string> = {
  quotation: 'quotations',
  invoice: 'invoices',
  sales_order: 'sales-orders',
  purchase_order: 'purchase-orders',
  bill: 'bills',
}

export const DOC_TYPE_LABELS: Record<CommercialDocType, { singular: string; plural: string }> = {
  quotation: { singular: 'Quotation', plural: 'Quotations' },
  invoice: { singular: 'Invoice', plural: 'Invoices' },
  sales_order: { singular: 'Sales order', plural: 'Sales orders' },
  purchase_order: { singular: 'Purchase order', plural: 'Purchase orders' },
  bill: { singular: 'Bill', plural: 'Bills' },
}

/** Status tone, shared by the list and the detail header. */
export function statusVariant(
  status: string,
): 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (['paid', 'received', 'accepted', 'fulfilled', 'approved', 'closed'].includes(status)) {
    return 'success'
  }
  if (['overdue', 'rejected', 'void'].includes(status)) return 'destructive'
  if (['pending_approval', 'partially_paid', 'partially_received', 'expired'].includes(status)) {
    return 'warning'
  }
  if (['sent', 'viewed', 'confirmed', 'in_progress', 'converted'].includes(status)) return 'outline'
  return 'secondary'
}
