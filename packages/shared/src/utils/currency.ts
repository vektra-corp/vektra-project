/**
 * Money helpers.
 *
 * All monetary columns are `numeric(12,2)` in Postgres and arrive as strings or
 * numbers over the wire. Arithmetic is done in integer minor units to avoid
 * float drift, then converted back for storage.
 */

/** Currencies with no minor unit (¥100, not ¥100.00). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
])

export function currencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2
}

/**
 * Decimal-correct rounding to a given number of places.
 *
 * `Math.round(1.005 * 100)` yields 100, because 1.005 is stored as
 * 1.00499999999999989 — so a naive implementation returns 1.00 where Postgres
 * `round(numeric, 2)` returns 1.01. Since the same arithmetic runs here for the
 * live preview and in the recalculate_document_totals trigger for the stored
 * value, a half-cent disagreement would show up as a total that changes on save.
 *
 * Shifting the decimal point via the string form ("1.005e2" parses to exactly
 * 100.5) avoids the representation error and matches Postgres.
 */
function shiftAndRound(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  if (decimals === 0) return Math.sign(value) * Math.round(Math.abs(value))

  const text = String(value)
  // Values already in exponential form cannot take another exponent suffix.
  if (text.includes('e') || text.includes('E')) {
    return Math.sign(value) * Math.round(Math.abs(value) * 10 ** decimals)
  }

  const shifted = Number(`${text}e${decimals}`)
  // Round half away from zero, matching Postgres numeric rounding.
  return Math.sign(shifted) * Math.round(Math.abs(shifted))
}

/** 12.34 USD -> 1234 (minor units). Used when talking to Stripe. */
export function toMinorUnits(amount: number, currency: string): number {
  return shiftAndRound(amount, currencyDecimals(currency))
}

/** 1234 minor units USD → 12.34 */
export function fromMinorUnits(minor: number, currency: string): number {
  const factor = 10 ** currencyDecimals(currency)
  return minor / factor
}

/** Parse a numeric column that Postgres may return as a string. */
export function parseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Round to the currency's precision — the only rounding used before storage. */
export function roundAmount(amount: number, currency = 'USD'): number {
  const decimals = currencyDecimals(currency)
  return shiftAndRound(amount, decimals) / 10 ** decimals
}

export interface LineItemInput {
  quantity: number
  unit_price: number
  /** Percentage, e.g. 7.5 for 7.5% */
  tax_rate: number
  /** Absolute discount applied to the line before tax */
  discount: number
}

export interface LineItemTotals {
  gross: number
  discount: number
  net: number
  tax: number
  line_total: number
}

/**
 * Single source of truth for line-item maths. The same function runs on the
 * client (live preview) and the server (persisted totals), so the two can never
 * disagree.
 */
export function calculateLineItem(item: LineItemInput, currency = 'USD'): LineItemTotals {
  const gross = roundAmount(item.quantity * item.unit_price, currency)
  const discount = roundAmount(Math.min(item.discount, gross), currency)
  const net = roundAmount(gross - discount, currency)
  const tax = roundAmount(net * (item.tax_rate / 100), currency)
  return { gross, discount, net, tax, line_total: roundAmount(net + tax, currency) }
}

export interface DocumentTotals {
  subtotal: number
  discount_total: number
  tax_total: number
  grand_total: number
}

/** Roll line items up into the totals stored on `commercial_documents`. */
export function calculateDocumentTotals(
  items: readonly LineItemInput[],
  currency = 'USD',
): DocumentTotals {
  let subtotal = 0
  let discountTotal = 0
  let taxTotal = 0

  for (const item of items) {
    const totals = calculateLineItem(item, currency)
    subtotal += totals.gross
    discountTotal += totals.discount
    taxTotal += totals.tax
  }

  subtotal = roundAmount(subtotal, currency)
  discountTotal = roundAmount(discountTotal, currency)
  taxTotal = roundAmount(taxTotal, currency)

  return {
    subtotal,
    discount_total: discountTotal,
    tax_total: taxTotal,
    grand_total: roundAmount(subtotal - discountTotal + taxTotal, currency),
  }
}
