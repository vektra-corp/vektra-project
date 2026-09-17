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
 * RETAINED FOR EXCLUSIVE-PRICED FIGURES ONLY. Catalogue prices are now stored
 * TAX-INCLUSIVE (see `netFromGross`), so this is no longer part of the
 * subscription pricing path. It stays because an exclusive base is still the
 * right input wherever a figure is quoted ex-tax.
 */
export function grossFromNet(netMinor: number, rateBp: number): number {
  return netMinor + taxOnNet(netMinor, rateBp)
}

/**
 * Back out the taxable base from a TAX-INCLUSIVE amount.
 *
 * Catalogue prices are the figure the customer is actually charged — tax is
 * contained within them, never added on top. The taxable base is therefore
 * derived, and the tax is whatever remains:
 *
 *     taxable = round(gross * 10000 / (10000 + rateBp))
 *     tax     = gross - taxable
 *
 * Defining tax as the REMAINDER rather than recomputing it from the base is
 * load-bearing. Recomputing drifts: at 18%, a gross of 115 paise backs out to a
 * base of 97, and 18% of 97 rounds to 17 — which totals 114, a paisa less than
 * the customer was quoted. Taking the remainder makes `taxable + tax == gross`
 * true for every input by construction, which is what an invoice has to show.
 */
export function netFromGross(grossMinor: number, rateBp: number): number {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) {
    throw new Error('grossMinor must be a non-negative integer')
  }
  return Math.round((grossMinor * BP) / (BP + rateBp))
}

/** The tax contained WITHIN a tax-inclusive amount. Always `gross - taxable`. */
export function taxWithinGross(grossMinor: number, rateBp: number): number {
  return grossMinor - netFromGross(grossMinor, rateBp)
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
 * What a subscription costs per cycle.
 *
 * The unit amount is TAX-INCLUSIVE, so this is the figure the customer is
 * charged, not a base to add tax to.
 *
 * Seats are counted server-side from `org_members`; nothing here ever accepts a
 * quantity from a client.
 */
export function subscriptionGrossMinor(unitAmountMinor: number, seats: number): number {
  if (!Number.isInteger(unitAmountMinor) || unitAmountMinor < 0) {
    throw new Error('unitAmountMinor must be a non-negative integer')
  }
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error('seats must be a positive integer')
  }
  return unitAmountMinor * seats
}
