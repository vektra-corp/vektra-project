import { describe, expect, it } from 'vitest'
import { calculateDocumentTotals, calculateLineItem } from '../utils/currency'
import { commercialDocCreateSchema, lineItemSchema, statusSchemaFor } from '../validators/commercial'

describe('statusSchemaFor', () => {
  it('accepts only statuses legal for that document type', () => {
    expect(statusSchemaFor('invoice').safeParse({ status: 'paid' }).success).toBe(true)
    // 'received' is a bill status, not an invoice one — the CHECK constraint
    // enforces this too; the schema turns it into a readable message.
    expect(statusSchemaFor('invoice').safeParse({ status: 'received' }).success).toBe(false)
    expect(statusSchemaFor('bill').safeParse({ status: 'received' }).success).toBe(true)
  })

  it('names the document type in the failure message', () => {
    const result = statusSchemaFor('purchase_order').safeParse({ status: 'paid' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('purchase order')
    }
  })

  it('covers the quotation lifecycle including converted', () => {
    for (const status of ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted']) {
      expect(statusSchemaFor('quotation').safeParse({ status }).success).toBe(true)
    }
  })
})

describe('lineItemSchema', () => {
  it('rejects a tax rate outside 0-100', () => {
    const base = { description: 'Work', quantity: 1, unit_price: 100 }
    expect(lineItemSchema.safeParse({ ...base, tax_rate: 20 }).success).toBe(true)
    expect(lineItemSchema.safeParse({ ...base, tax_rate: 120 }).success).toBe(false)
    expect(lineItemSchema.safeParse({ ...base, tax_rate: -1 }).success).toBe(false)
  })

  it('rejects negative money', () => {
    expect(
      lineItemSchema.safeParse({ description: 'W', quantity: 1, unit_price: -5 }).success,
    ).toBe(false)
    expect(
      lineItemSchema.safeParse({ description: 'W', quantity: -1, unit_price: 5 }).success,
    ).toBe(false)
  })

  it('requires a description', () => {
    expect(lineItemSchema.safeParse({ description: '   ', quantity: 1, unit_price: 5 }).success).toBe(
      false,
    )
  })
})

describe('commercialDocCreateSchema', () => {
  const valid = {
    doc_type: 'invoice',
    workspace_id: '11111111-1111-1111-1111-111111111111',
    issue_date: '2026-03-01',
  }

  it('defaults line items to an empty list', () => {
    const result = commercialDocCreateSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.line_items).toEqual([])
  })

  it('does not accept client-supplied totals', () => {
    const result = commercialDocCreateSchema.safeParse({
      ...valid,
      grand_total: 999999,
      subtotal: 999999,
    })
    expect(result.success).toBe(true)
    // Zod strips unknown keys, so forged totals never reach the insert — the
    // database triggers are the only writer of these columns.
    if (result.success) {
      expect('grand_total' in result.data).toBe(false)
      expect('subtotal' in result.data).toBe(false)
    }
  })
})

describe('line maths mirrors the database triggers', () => {
  it('caps a discount at the line gross, as set_line_total does', () => {
    const line = calculateLineItem(
      { quantity: 2, unit_price: 50, tax_rate: 0, discount: 500 },
      'USD',
    )
    // Gross is 100; a 500 discount cannot make the line negative.
    expect(line.discount).toBe(100)
    expect(line.line_total).toBe(0)
  })

  it('taxes the net, not the gross', () => {
    const line = calculateLineItem(
      { quantity: 1, unit_price: 100, tax_rate: 10, discount: 20 },
      'USD',
    )
    expect(line.net).toBe(80)
    expect(line.tax).toBe(8)
    expect(line.line_total).toBe(88)
  })

  it('rolls lines up the way recalculate_document_totals does', () => {
    const totals = calculateDocumentTotals(
      [
        { quantity: 2, unit_price: 100, tax_rate: 10, discount: 0 },
        { quantity: 1, unit_price: 50, tax_rate: 0, discount: 10 },
      ],
      'USD',
    )

    expect(totals.subtotal).toBe(250)
    expect(totals.discount_total).toBe(10)
    expect(totals.tax_total).toBe(20)
    expect(totals.grand_total).toBe(260)
  })
})
