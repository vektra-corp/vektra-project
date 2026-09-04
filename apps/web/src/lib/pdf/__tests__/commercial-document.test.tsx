import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { CommercialDocumentPdf, type PdfDocumentData } from '../commercial-document'

/**
 * The renderer either produces a PDF or throws on a style it does not support,
 * and a broken style is not visible from types. Rendering for real is the only
 * check worth having.
 */
const base: PdfDocumentData = {
  docTypeLabel: 'Invoice',
  docNumber: 'INV-2026-0001',
  status: 'sent',
  issueDate: '2026-09-01',
  dueLabel: 'Due',
  dueDate: '2026-09-30',
  organization: {
    name: 'Vektra Corp',
    address: '1 Example Street, London',
    taxId: 'GB123456789',
    email: 'billing@vektracorp.in',
  },
  contact: {
    name: 'Pat Client',
    company: 'Client Co',
    address: '9 Other Road, Manchester',
    email: 'pat@client.invalid',
  },
  lineItems: [
    {
      description: 'Delivery work, September',
      quantity: '10',
      unitPrice: '$120.00',
      taxRate: '20%',
      lineTotal: '$1,440.00',
    },
  ],
  subtotal: '$1,700.00',
  discountTotal: null,
  taxTotal: '$240.00',
  grandTotal: '$1,940.00',
  amountPaid: '$500.00',
  outstanding: '$1,440.00',
  notes: 'Thanks for your business.',
  terms: 'Payable within 30 days.',
  currency: 'USD',
}

async function render(data: PdfDocumentData) {
  return renderToBuffer(CommercialDocumentPdf({ data }))
}

describe('CommercialDocumentPdf', () => {
  it('renders a structurally valid PDF', async () => {
    const buffer = await render(base)

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buffer.subarray(-1024).toString('latin1')).toContain('%%EOF')
    expect(buffer.length).toBeGreaterThan(1000)
  }, 30_000)

  it('renders with every optional field absent', async () => {
    // A draft with no contact, no dates and no line items must still produce a
    // document rather than throwing on a null.
    const buffer = await render({
      ...base,
      dueDate: null,
      contact: null,
      lineItems: [],
      discountTotal: null,
      amountPaid: null,
      outstanding: null,
      notes: null,
      terms: null,
      organization: { name: 'Vektra Corp', address: null, taxId: null, email: null },
    })

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('paginates a long document without failing', async () => {
    const lineItems = Array.from({ length: 80 }, (_, index) => ({
      description: `Line item ${index + 1} with a reasonably long description to force wrapping`,
      quantity: '1',
      unitPrice: '$100.00',
      taxRate: '20%',
      lineTotal: '$120.00',
    }))

    const buffer = await render({ ...base, lineItems })
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // More content than one page holds.
    expect(buffer.length).toBeGreaterThan(3000)
  }, 30_000)
})
