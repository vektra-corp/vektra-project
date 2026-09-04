import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  COMMERCIAL_DOC_TYPES,
  parsePdfTemplate,
  type CommercialDocType,
} from '@pm/shared/constants'
import { formatCurrency, formatDate } from '@pm/shared/utils'
import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse, type NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth/context'
import {
  CommercialDocumentPdf,
  type PdfDocumentData,
  type PdfLineItem,
} from '@/lib/pdf/commercial-document'
import { fetchLogoDataUri } from '@/lib/pdf/logo'
import { createClient } from '@/lib/supabase/server'

/**
 * Render one commercial document as a PDF.
 *
 * A route rather than a server action because the response is a file. Auth is
 * the same as everywhere else — `getAuthContext` plus the manager check that
 * gates the commercial module — and the query runs through the RLS-scoped
 * client, so a document in another tenant is simply not found.
 *
 * Rendering is CPU-bound and pulls in a large dependency, so this route is
 * deliberately the only place @react-pdf/renderer is imported; nothing in the
 * page bundle touches it.
 */

const DOC_TYPE_LABELS: Record<CommercialDocType, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  sales_order: 'Sales order',
  purchase_order: 'Purchase order',
  bill: 'Bill',
}

function joinAddress(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const address = raw as Record<string, unknown>
  const parts = ['street', 'city', 'state', 'zip', 'country']
    .map((key) => address[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return parts.length > 0 ? parts.join(', ') : null
}

export async function GET(
  request: NextRequest,
  { params }: { params: { documentId: string } },
) {
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

  const supabase = createClient()

  const [{ data: doc }, { data: lineItems }, { data: organization }] = await Promise.all([
    supabase
      .from('commercial_documents')
      .select(
        `id, doc_type, doc_number, status, issue_date, due_date, valid_until, currency,
         subtotal, tax_total, discount_total, grand_total, amount_paid, notes, terms,
         pdf_template_id,
         contact:contacts!commercial_documents_contact_id_fkey(contact_name, company_name, email, address)`,
      )
      .eq('id', params.documentId)
      .eq('organization_id', auth.orgId)
      .maybeSingle(),
    supabase
      .from('commercial_line_items')
      .select('description, quantity, unit_price, tax_rate, line_total')
      .eq('document_id', params.documentId)
      .order('position'),
    supabase
      .from('organizations')
      .select('name, address, tax_id, billing_email, logo_url')
      .eq('id', auth.orgId)
      .maybeSingle(),
  ])

  // RLS returns nothing for another tenant's document, which is the same
  // observable outcome as one that does not exist. That is deliberate.
  if (!doc || !organization) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const docType = doc.doc_type as CommercialDocType
  if (!(COMMERCIAL_DOC_TYPES as readonly string[]).includes(docType)) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  // The document's own template, else this doc type's default for the org,
  // else the built-in. A second round trip, but only after the document has
  // been confirmed to exist and belong to the caller.
  const templateQuery = supabase
    .from('pdf_templates')
    .select('template_data')
    .eq('organization_id', auth.orgId)
    .limit(1)

  const { data: templateRow } = doc.pdf_template_id
    ? await templateQuery.eq('id', doc.pdf_template_id).maybeSingle()
    : await templateQuery.eq('doc_type', docType).eq('is_default', true).maybeSingle()

  const template = parsePdfTemplate(templateRow?.template_data)

  // Fetched here, never by the renderer: an `Image src` the renderer resolves
  // would be an outbound request to a customer-controlled URL on every PDF.
  const logo = template.showLogo ? await fetchLogoDataUri(organization.logo_url) : null

  const locale = 'en'
  const money = (value: unknown) => formatCurrency(Number(value ?? 0), doc.currency, locale)
  const date = (value: string) => formatDate(value, { locale, dateFormat: 'YYYY-MM-DD' })

  const contact = Array.isArray(doc.contact) ? doc.contact[0] : doc.contact
  const paid = Number(doc.amount_paid)
  const takesPayment = docType === 'invoice' || docType === 'bill'

  const items: PdfLineItem[] = (lineItems ?? []).map((item) => ({
    description: item.description,
    quantity: String(Number(item.quantity)),
    unitPrice: money(item.unit_price),
    taxRate: `${Number(item.tax_rate)}%`,
    lineTotal: money(item.line_total),
  }))

  const data: PdfDocumentData = {
    docTypeLabel: DOC_TYPE_LABELS[docType],
    docNumber: doc.doc_number,
    status: doc.status,
    issueDate: date(doc.issue_date),
    dueLabel: docType === 'quotation' ? 'Valid until' : 'Due',
    dueDate: docType === 'quotation' ? (doc.valid_until ? date(doc.valid_until) : null) : doc.due_date ? date(doc.due_date) : null,
    organization: {
      name: organization.name,
      address: joinAddress(organization.address),
      taxId: organization.tax_id,
      email: organization.billing_email,
      logo,
    },
    contact: contact
      ? {
          name: contact.contact_name,
          company: contact.company_name,
          address: joinAddress(contact.address),
          email: contact.email,
        }
      : null,
    lineItems: items,
    subtotal: money(doc.subtotal),
    // Only shown when there is one, so a clean document has no empty row.
    discountTotal: Number(doc.discount_total) > 0 ? money(doc.discount_total) : null,
    taxTotal: money(doc.tax_total),
    grandTotal: money(doc.grand_total),
    amountPaid: takesPayment && paid > 0 ? money(paid) : null,
    outstanding: takesPayment && paid > 0 ? money(Number(doc.grand_total) - paid) : null,
    notes: doc.notes,
    terms: doc.terms,
    currency: doc.currency,
  }

  const buffer = await renderToBuffer(CommercialDocumentPdf({ data, template }))

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` so a click previews in the browser; the filename still applies
      // when someone saves it.
      'Content-Disposition': `inline; filename="${doc.doc_number}.pdf"`,
      // A document can be edited while in draft, so the PDF must not be cached
      // by a proxy on the way back.
      'Cache-Control': 'private, no-store',
    },
  })
}
