import { GST_RATE_BP, splitCgstSgst, taxOnNet } from './amounts'
import type { TaxTreatment } from './types'

/**
 * Indian GST for a subscription charge, and the zero-rated export case.
 *
 * Pure, integer-only, and total by construction: every branch returns a
 * `totalMinor` equal to the sum of its own parts, which is what lets the
 * `billing_invoices_total_adds_up` CHECK be an assertion rather than a hazard.
 *
 * The rate is the same 18% whether a supply is intra-state or inter-state —
 * only the SPLIT differs (CGST 9 + SGST 9 versus IGST 18). So the amount the
 * gateway charges never depends on which Indian state the buyer is in, and a
 * customer moving state does not change what they pay.
 */

/** Place-of-supply code for a supply outside India. */
export const PLACE_OF_SUPPLY_OTHER_TERRITORY = '96'

export interface TaxInput {
  /** Tax-exclusive base, in minor units. */
  netMinor: number
  /** ISO 3166-1 alpha-2. */
  buyerCountry: string | null | undefined
  buyerGstin: string | null | undefined
  /** Two-digit GST state code from the billing address. */
  buyerState: string | null | undefined
  /** Two-digit GST state code of the seller. */
  sellerState: string
  /** Letter of Undertaking reference, if one is on file and currently valid. */
  lutArn?: string | null
  rateBp?: number
}

export interface TaxResult {
  treatment: TaxTreatment
  placeOfSupply: string
  taxableMinor: number
  cgstRateBp: number
  sgstRateBp: number
  igstRateBp: number
  cgstMinor: number
  sgstMinor: number
  igstMinor: number
  totalMinor: number
  /**
   * True when we are charging IGST on an export because no valid LUT is on
   * file. Lawful, but it means an 18% cost we then have to reclaim — so the
   * caller must surface it rather than absorb it silently.
   */
  requiresOperatorAttention: boolean
}

const ZERO = {
  cgstRateBp: 0,
  sgstRateBp: 0,
  igstRateBp: 0,
  cgstMinor: 0,
  sgstMinor: 0,
  igstMinor: 0,
}

/**
 * Where a supply is treated as made.
 *
 * A registered buyer's GSTIN is authoritative — its first two digits ARE the
 * state. Falling back to the billing address, and then to the seller's own
 * state, follows s.12(2)(b) of the IGST Act for a recipient with no address on
 * record.
 */
export function placeOfSupply(input: {
  buyerCountry: string | null | undefined
  buyerGstin: string | null | undefined
  buyerState: string | null | undefined
  sellerState: string
}): string {
  if (input.buyerCountry?.toUpperCase() !== 'IN') return PLACE_OF_SUPPLY_OTHER_TERRITORY
  if (input.buyerGstin && input.buyerGstin.length >= 2) return input.buyerGstin.slice(0, 2)
  return input.buyerState || input.sellerState
}

export function computeTax(input: TaxInput): TaxResult {
  const { netMinor, sellerState, lutArn } = input
  const rateBp = input.rateBp ?? GST_RATE_BP

  if (!Number.isInteger(netMinor) || netMinor < 0) {
    throw new Error('netMinor must be a non-negative integer')
  }

  const pos = placeOfSupply(input)
  const isExport = input.buyerCountry?.toUpperCase() !== 'IN'

  // --- Export of services --------------------------------------------------
  if (isExport) {
    // With a valid LUT the supply is zero-rated and nothing is collected.
    if (lutArn) {
      return {
        treatment: 'export_lut',
        placeOfSupply: PLACE_OF_SUPPLY_OTHER_TERRITORY,
        taxableMinor: netMinor,
        ...ZERO,
        totalMinor: netMinor,
        requiresOperatorAttention: false,
      }
    }

    // Without one, the lawful treatment is to charge IGST and claim it back.
    // Flagged, because quietly eating 18% is a real loss rather than a rounding.
    const tax = taxOnNet(netMinor, rateBp)
    return {
      treatment: 'export_with_igst',
      placeOfSupply: PLACE_OF_SUPPLY_OTHER_TERRITORY,
      taxableMinor: netMinor,
      ...ZERO,
      igstRateBp: rateBp,
      igstMinor: tax,
      totalMinor: netMinor + tax,
      requiresOperatorAttention: true,
    }
  }

  // --- Domestic supply -----------------------------------------------------
  const tax = taxOnNet(netMinor, rateBp)

  if (pos === sellerState) {
    const { cgstMinor, sgstMinor } = splitCgstSgst(tax)
    const half = Math.round(rateBp / 2)
    return {
      treatment: 'intra_state',
      placeOfSupply: pos,
      taxableMinor: netMinor,
      ...ZERO,
      cgstRateBp: half,
      sgstRateBp: half,
      cgstMinor,
      sgstMinor,
      totalMinor: netMinor + tax,
      requiresOperatorAttention: false,
    }
  }

  return {
    treatment: 'inter_state',
    placeOfSupply: pos,
    taxableMinor: netMinor,
    ...ZERO,
    igstRateBp: rateBp,
    igstMinor: tax,
    totalMinor: netMinor + tax,
    requiresOperatorAttention: false,
  }
}

/** The Indian financial year a date falls in. 1 April to 31 March. */
export function fiscalYearKey(date: Date): string {
  const month = date.getUTCMonth() + 1
  const year = date.getUTCFullYear()
  const start = month >= 4 ? year : year - 1
  const pad = (n: number) => String(n % 100).padStart(2, '0')
  return `${pad(start)}-${pad(start + 1)}`
}
