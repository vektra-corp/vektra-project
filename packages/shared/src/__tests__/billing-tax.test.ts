import { describe, expect, it } from 'vitest'
import {
  GST_RATE_BP,
  computeTax,
  fiscalYearKey,
  grossFromNet,
  placeOfSupply,
  splitCgstSgst,
  subscriptionNetMinor,
  taxOnNet,
} from '../billing'

const SELLER_STATE = '33' // Tamil Nadu

/** Every invoice must be able to satisfy billing_invoices_total_adds_up. */
function assertBalances(r: ReturnType<typeof computeTax>) {
  expect(r.totalMinor).toBe(r.taxableMinor + r.cgstMinor + r.sgstMinor + r.igstMinor)
}

describe('taxOnNet / grossFromNet', () => {
  it('adds 18% to a tax-exclusive amount', () => {
    expect(taxOnNet(100_000, GST_RATE_BP)).toBe(18_000)
    expect(grossFromNet(100_000, GST_RATE_BP)).toBe(118_000)
  })

  it('returns integers for amounts that do not divide evenly', () => {
    // 1 paisa of tax on 1 paisa base rounds to 0; the result is still an integer.
    for (const net of [1, 3, 7, 99, 12_345, 999_999]) {
      const tax = taxOnNet(net, GST_RATE_BP)
      expect(Number.isInteger(tax)).toBe(true)
      expect(Number.isInteger(grossFromNet(net, GST_RATE_BP))).toBe(true)
    }
  })
})

describe('splitCgstSgst', () => {
  it('splits an even total in half', () => {
    expect(splitCgstSgst(18_000)).toEqual({ cgstMinor: 9_000, sgstMinor: 9_000 })
  })

  it('puts the odd paisa on SGST and never loses it', () => {
    const { cgstMinor, sgstMinor } = splitCgstSgst(101)
    expect(cgstMinor).toBe(50)
    expect(sgstMinor).toBe(51)
    expect(cgstMinor + sgstMinor).toBe(101)
  })

  it('keeps the two halves within one paisa, as the CHECK constraint requires', () => {
    for (let total = 0; total < 500; total++) {
      const { cgstMinor, sgstMinor } = splitCgstSgst(total)
      expect(cgstMinor + sgstMinor).toBe(total)
      expect(Math.abs(cgstMinor - sgstMinor)).toBeLessThanOrEqual(1)
    }
  })
})

describe('placeOfSupply', () => {
  it('prefers the buyer GSTIN, whose first two digits are the state', () => {
    expect(
      placeOfSupply({
        buyerCountry: 'IN',
        buyerGstin: '29ABCDE1234F1Z5',
        buyerState: '33',
        sellerState: SELLER_STATE,
      }),
    ).toBe('29')
  })

  it('falls back to the billing address state without a GSTIN', () => {
    expect(
      placeOfSupply({
        buyerCountry: 'IN',
        buyerGstin: null,
        buyerState: '27',
        sellerState: SELLER_STATE,
      }),
    ).toBe('27')
  })

  it('falls back to the seller state when nothing is on record', () => {
    expect(
      placeOfSupply({
        buyerCountry: 'IN',
        buyerGstin: null,
        buyerState: null,
        sellerState: SELLER_STATE,
      }),
    ).toBe(SELLER_STATE)
  })

  it('is other-territory for anything outside India', () => {
    expect(
      placeOfSupply({
        buyerCountry: 'US',
        buyerGstin: null,
        buyerState: null,
        sellerState: SELLER_STATE,
      }),
    ).toBe('96')
  })
})

describe('computeTax', () => {
  const base = {
    netMinor: 100_000,
    sellerState: SELLER_STATE,
    lutArn: null as string | null,
  }

  it('splits into CGST and SGST for a buyer in the seller state', () => {
    const r = computeTax({
      ...base,
      buyerCountry: 'IN',
      buyerGstin: '33ABCDE1234F1Z5',
      buyerState: '33',
    })
    expect(r.treatment).toBe('intra_state')
    expect(r.cgstMinor).toBe(9_000)
    expect(r.sgstMinor).toBe(9_000)
    expect(r.igstMinor).toBe(0)
    expect(r.cgstRateBp).toBe(900)
    expect(r.totalMinor).toBe(118_000)
    assertBalances(r)
  })

  it('charges IGST for a buyer in another state', () => {
    const r = computeTax({
      ...base,
      buyerCountry: 'IN',
      buyerGstin: '29ABCDE1234F1Z5',
      buyerState: '29',
    })
    expect(r.treatment).toBe('inter_state')
    expect(r.igstMinor).toBe(18_000)
    expect(r.cgstMinor).toBe(0)
    expect(r.sgstMinor).toBe(0)
    expect(r.totalMinor).toBe(118_000)
    assertBalances(r)
  })

  it('charges the same total either way, so moving state changes nothing', () => {
    const intra = computeTax({ ...base, buyerCountry: 'IN', buyerGstin: null, buyerState: '33' })
    const inter = computeTax({ ...base, buyerCountry: 'IN', buyerGstin: null, buyerState: '29' })
    expect(intra.totalMinor).toBe(inter.totalMinor)
  })

  it('zero-rates an export when an LUT is on file', () => {
    const r = computeTax({
      ...base,
      buyerCountry: 'US',
      buyerGstin: null,
      buyerState: null,
      lutArn: 'AD330124000123X',
    })
    expect(r.treatment).toBe('export_lut')
    expect(r.totalMinor).toBe(100_000)
    expect(r.igstMinor).toBe(0)
    expect(r.requiresOperatorAttention).toBe(false)
    assertBalances(r)
  })

  it('charges IGST on an export with no LUT, and flags it for an operator', () => {
    const r = computeTax({ ...base, buyerCountry: 'US', buyerGstin: null, buyerState: null })
    expect(r.treatment).toBe('export_with_igst')
    expect(r.igstMinor).toBe(18_000)
    // Absorbing 18% silently would be a real loss, not a rounding difference.
    expect(r.requiresOperatorAttention).toBe(true)
    assertBalances(r)
  })

  it('balances for every treatment across awkward amounts', () => {
    for (const netMinor of [0, 1, 3, 7, 99, 101, 12_345, 999_999, 1_234_567]) {
      for (const [country, state] of [
        ['IN', '33'],
        ['IN', '29'],
        ['US', null],
      ] as const) {
        assertBalances(
          computeTax({
            netMinor,
            sellerState: SELLER_STATE,
            buyerCountry: country,
            buyerGstin: null,
            buyerState: state,
            lutArn: null,
          }),
        )
      }
    }
  })

  it('refuses a non-integer or negative base', () => {
    const bad = { ...base, buyerCountry: 'IN', buyerGstin: null, buyerState: '33' }
    expect(() => computeTax({ ...bad, netMinor: -1 })).toThrow()
    expect(() => computeTax({ ...bad, netMinor: 1.5 })).toThrow()
  })
})

describe('subscriptionNetMinor', () => {
  it('multiplies the per-seat price by the seat count', () => {
    expect(subscriptionNetMinor(49_900, 7)).toBe(349_300)
  })

  it('refuses a seat count or price that could not have come from the server', () => {
    expect(() => subscriptionNetMinor(49_900, 0)).toThrow()
    expect(() => subscriptionNetMinor(49_900, 1.5)).toThrow()
    expect(() => subscriptionNetMinor(-1, 3)).toThrow()
  })
})

describe('fiscalYearKey', () => {
  it('starts the Indian financial year on 1 April', () => {
    expect(fiscalYearKey(new Date('2026-03-31T00:00:00Z'))).toBe('25-26')
    expect(fiscalYearKey(new Date('2026-04-01T00:00:00Z'))).toBe('26-27')
  })

  it('keeps January in the previous year band', () => {
    expect(fiscalYearKey(new Date('2027-01-15T00:00:00Z'))).toBe('26-27')
  })
})
