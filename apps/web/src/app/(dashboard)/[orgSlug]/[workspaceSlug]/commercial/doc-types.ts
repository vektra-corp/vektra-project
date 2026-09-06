import type { CommercialDocType } from '@pm/shared/constants'

/**
 * URL segment ↔ doc_type mapping.
 *
 * The database stores singular snake_case; the URL reads better plural. Keeping
 * the map in one place means neither has to bend to the other.
 *
 * Quotations are the only commercial document left (migration 00035). The map
 * survives the removal because the routes are still segment-driven and a
 * quotation is still numbered, templated and rendered through the shared
 * machinery — an unknown segment now simply has nothing to match.
 */
export const SEGMENT_TO_DOC_TYPE: Record<string, CommercialDocType> = {
  quotations: 'quotation',
}

export const DOC_TYPE_TO_SEGMENT: Record<CommercialDocType, string> = {
  quotation: 'quotations',
}

export const DOC_TYPE_LABELS: Record<CommercialDocType, { singular: string; plural: string }> = {
  quotation: { singular: 'Quotation', plural: 'Quotations' },
}

/** Status tone, shared by the list and the detail header. */
export function statusVariant(
  status: string,
): 'secondary' | 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'accepted') return 'success'
  if (status === 'rejected') return 'destructive'
  if (status === 'expired') return 'warning'
  if (status === 'sent' || status === 'viewed') return 'outline'
  return 'secondary'
}
