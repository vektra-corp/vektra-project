import { describe, expect, it } from 'vitest'
import {
  calculateDocumentTotals,
  calculateLineItem,
  currencyDecimals,
  fromMinorUnits,
  parseAmount,
  roundAmount,
  toMinorUnits,
} from '../utils/currency'

/**
 * Money maths (claude.md §14: "Utility functions").
 *
 * These run on the client for the live preview and are mirrored by the
 * recalculate_document_totals trigger in SQL, so the two must agree exactly.
 */

describe('minor units', () => {
  it('round-trips a two-decimal currency', () => {
    expect(toMinorUnits(12.34, 'USD')).toBe(1234)
    expect(fromMinorUnits(1234, 'USD')).toBe(12.34)
  })

  it('treats zero-decimal currencies as whole units', () => {
    expect(currencyDecimals('JPY')).toBe(0)
    expect(toMinorUnits(1500, 'JPY')).toBe(1500)
    expect(fromMinorUnits(1500, 'JPY')).toBe(1500)
  })

  it('is case-insensitive about the currency code', () => {
    expect(currencyDecimals('jpy')).toBe(0)
  })

  it('avoids float drift on values that cannot be represented exactly', () => {
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30)
    expect(roundAmount(1.005, 'USD')).toBe(1.01)
  })
})

describe('parseAmount', () => {
  it('accepts the strings Postgres returns for numeric columns', () => {
    expect(parseAmount('1234.56')).toBe(1234.56)
    expect(parseAmount(1234.56)).toBe(1234.56)
  })

  it('treats null, undefined and junk as zero', () => {
    expect(parseAmount(null)).toBe(0)
    expect(parseAmount(undefined)).toBe(0)
    expect(parseAmount('not a number')).toBe(0)
  })
})

describe('calculateLineItem', () => {
  it('applies discount before tax', () => {
    const totals = calculateLineItem(
      { quantity: 2, unit_price: 100, tax_rate: 10, discount: 50 },
      'USD',
    )
    expect(totals.gross).toBe(200)
    expect(totals.discount).toBe(50)
    expect(totals.net).toBe(150)
    expect(totals.tax).toBe(15)
    expect(totals.line_total).toBe(165)
  })

  it('caps a discount at the gross so a line cannot go negative', () => {
    const totals = calculateLineItem(
      { quantity: 1, unit_price: 10, tax_rate: 0, discount: 999 },
      'USD',
    )
    expect(totals.discount).toBe(10)
    expect(totals.net).toBe(0)
    expect(totals.line_total).toBe(0)
  })

  it('handles fractional quantities', () => {
    const totals = calculateLineItem(
      { quantity: 1.5, unit_price: 33.33, tax_rate: 0, discount: 0 },
      'USD',
    )
    expect(totals.gross).toBe(50)
  })
})

describe('calculateDocumentTotals', () => {
  it('rolls line items up into document totals', () => {
    const totals = calculateDocumentTotals(
      [
        { quantity: 2, unit_price: 100, tax_rate: 10, discount: 0 },
        { quantity: 1, unit_price: 50, tax_rate: 20, discount: 10 },
      ],
      'USD',
    )
    expect(totals.subtotal).toBe(250)
    expect(totals.discount_total).toBe(10)
    expect(totals.tax_total).toBe(28)
    expect(totals.grand_total).toBe(268)
  })

  it('returns zeroes for an empty document', () => {
    expect(calculateDocumentTotals([], 'USD')).toEqual({
      subtotal: 0,
      discount_total: 0,
      tax_total: 0,
      grand_total: 0,
    })
  })

  it('keeps grand_total equal to subtotal minus discount plus tax', () => {
    const items = [
      { quantity: 3, unit_price: 19.99, tax_rate: 7.5, discount: 5 },
      { quantity: 7, unit_price: 4.25, tax_rate: 0, discount: 0 },
    ]
    const totals = calculateDocumentTotals(items, 'USD')
    expect(totals.grand_total).toBeCloseTo(
      totals.subtotal - totals.discount_total + totals.tax_total,
      2,
    )
  })
})
