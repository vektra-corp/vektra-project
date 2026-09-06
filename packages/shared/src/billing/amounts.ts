/**
 * Amount arithmetic for subscription billing.
 *
 * Integer minor units throughout. The commercial module works in
 * `numeric(12,2)` because those are human-entered figures reconciled by eye;
 * these are reconciled against a gateway to the paisa, so nothing here is ever
 * allowed to become a float.
 */

/** GST on software services, in basis points. 1800 = 18.00%. */
export const GST_RATE_BP = 1800

/** Basis-point denominator. */
const BP = 10_000

/**
 * Add tax to a tax-exclusive amount.
 *
 * `plan_prices.unit_amount_minor` is stored tax-exclusive, but a gateway plan
 * charges one inclusive figure, so this is what the gateway plan is created at.
 */
export function grossFromNet(netMinor: number, rateBp: number): number {
  return netMinor + taxOnNet(netMinor, rateBp)
}

/** The tax component of a tax-exclusive amount. Rounded half away from zero. */
export function taxOnNet(netMinor: number, rateBp: number): number {
  return Math.round((netMinor * rateBp) / BP)
}

/**
 * Split a GST total into its CGST and SGST halves.
 *
 * The odd paisa lands on SGST, deterministically. The invoice CHECK constraint
 * permits the two halves to differ by one for exactly this reason — an
 * arbitrary tie-break here would otherwise make some invoices unstorable.
 */
export function splitCgstSgst(taxMinor: number): { cgstMinor: number; sgstMinor: number } {
  const cgstMinor = Math.floor(taxMinor / 2)
  return { cgstMinor, sgstMinor: taxMinor - cgstMinor }
}

/**
 * What a subscription costs per cycle, before tax.
 *
 * Seats are counted server-side from `org_members`; nothing here ever accepts a
 * quantity from a client.
 */
export function subscriptionNetMinor(unitAmountMinor: number, seats: number): number {
  if (!Number.isInteger(unitAmountMinor) || unitAmountMinor < 0) {
    throw new Error('unitAmountMinor must be a non-negative integer')
  }
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error('seats must be a positive integer')
  }
  return unitAmountMinor * seats
}
