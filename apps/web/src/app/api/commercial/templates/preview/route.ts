import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { parsePdfTemplate } from '@pm/shared/constants'
import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'
import { CommercialDocumentPdf, type PdfDocumentData } from '@/lib/pdf/commercial-document'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * Render a template preview from sample data.
 *
 * A POST because the editor sends the template it is currently showing, not one
 * that has been saved — an editor that needs a save before you can see the
 * change is not much of an editor.
 *
 * Accepting a template in a request body is safe for exactly one reason:
 * `parsePdfTemplate` reduces whatever arrives to a bounded, validated
 * structure. Nothing else here trusts the body. The sample document is fixed
 * server-side, so the body cannot inject content into the page either.
 *
 * Rate limited because rendering is CPU-bound and this is the one PDF endpoint
 * a client can call in a loop.
 */

const SAMPLE: PdfDocumentData = {
  docTypeLabel: 'Invoice',
  docNumber: 'INV-2026-0042',
  status: 'sent',
  issueDate: '2026-09-01',
  dueLabel: 'Due',
  dueDate: '2026-09-30',
  organization: {
    name: 'Your organization',
    address: '1 Example Street, London, EC1A 1BB',
    taxId: 'GB123456789',
    email: 'billing@example.com',
    logo: null,
  },
  contact: {
    name: 'Sample Client',
    company: 'Client Company Ltd',
    address: '9 Other Road, Manchester, M1 2AB',
    email: 'accounts@client.example',
  },
  lineItems: [
    {
      description: 'Design and discovery workshop',
      quantity: '2',
      unitPrice: '$750.00',
      taxRate: '20%',
      lineTotal: '$1,800.00',
    },
    {
      description: 'Implementation, September',
      quantity: '12',
      unitPrice: '$120.00',
      taxRate: '20%',
      lineTotal: '$1,728.00',
    },
    {
      description: 'Support retainer',
      quantity: '1',
      unitPrice: '$400.00',
      taxRate: '0%',
      lineTotal: '$400.00',
    },
  ],
  subtotal: '$3,340.00',
  discountTotal: '$100.00',
  taxTotal: '$588.00',
  grandTotal: '$3,828.00',
  amountPaid: '$1,000.00',
  outstanding: '$2,828.00',
  notes: 'Thank you for your business. Payment details are on the last page.',
  terms: 'Payable within 30 days of the issue date.',
  currency: 'USD',
}

export async function POST(request: NextRequest) {
  const orgSlug = request.nextUrl.searchParams.get('org')
  if (!orgSlug) {
    return NextResponse.json({ error: 'Missing organization', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const auth = await getAuthContext(orgSlug)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 })
  }

  const limit = await checkRateLimit('api', `pdf-preview:${auth.userId}`)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many requests', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  const template = parsePdfTemplate(body)
  // The preview never fetches a logo: it would be a network request per
  // keystroke, and the sample organisation does not have one anyway.
  const buffer = await renderToBuffer(
    CommercialDocumentPdf({ data: SAMPLE, template: { ...template, showLogo: false } }),
  )

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="template-preview.pdf"',
      'Cache-Control': 'no-store',
    },
  })
}
