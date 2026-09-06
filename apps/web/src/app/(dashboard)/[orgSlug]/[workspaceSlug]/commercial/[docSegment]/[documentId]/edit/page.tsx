import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveCommercialDoc } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'
import { SEGMENT_TO_DOC_TYPE } from '../../../doc-types'
import { DocumentForm } from '../../../document-form'
import { blankLine } from '../../../line-item-editor'

export const metadata: Metadata = { title: 'Edit document' }

export default async function EditCommercialDocPage({
  params,
}: {
  params: {
    orgSlug: string
    workspaceSlug: string
    docSegment: string
    documentId: string
  }
}) {
  const docType = SEGMENT_TO_DOC_TYPE[params.docSegment]
  if (!docType) notFound()

  const auth = await requireAuthPage(params.orgSlug)

  // The URL carries the quotation's 16-digit public id.
  const resolved = await resolveCommercialDoc(params.documentId)
  if (!resolved) notFound()

  const locale = await getLocale()
  const supabase = createClient()

  const [{ data: doc }, { data: lineItems }, { data: contacts }, { data: projects }] =
    await Promise.all([
      supabase
        .from('commercial_documents')
        .select(
          'id, doc_type, doc_number, status, workspace_id, project_id, contact_id, issue_date, due_date, valid_until, currency, notes, terms',
        )
        .eq('id', resolved.id)
        .eq('organization_id', auth.orgId)
        .maybeSingle(),
      supabase
        .from('commercial_line_items')
        .select('id, description, quantity, unit_price, tax_rate, discount')
        .eq('document_id', resolved.id)
        .order('position'),
      supabase
        .from('contacts')
        .select('id, contact_name, company_name, type')
        .eq('organization_id', auth.orgId)
        .order('contact_name'),
      supabase
        .from('projects')
        .select('id, name')
        .eq('organization_id', auth.orgId)
        .eq('status', 'active')
        .order('name'),
    ])

  if (!doc || doc.doc_type !== docType) notFound()

  const base = `/${params.orgSlug}/${params.workspaceSlug}/commercial/${params.docSegment}`

  // The action refuses this too; catching it here means the person sees why
  // instead of filling in a form that cannot be saved.
  if (!['draft', 'received', 'pending_approval'].includes(doc.status)) {
    return (
      <PageBody className="pt-2">
        <div className="mx-auto max-w-md rounded-lg border border-dashed border-border px-5 py-12 text-center">
          <p className="text-base font-medium">{doc.doc_number} can no longer be edited</p>
          <p className="pt-1.5 text-base text-muted-foreground">
            It is {doc.status.replace('_', ' ')}, and the other party already has this version.
          </p>
          <Link
            href={`${base}/${params.documentId}`}
            className="mt-4 inline-block text-base text-primary hover:underline"
          >
            Back to the document
          </Link>
        </div>
      </PageBody>
    )
  }

  const contactOptions = (contacts ?? [])
    .filter((contact) => contact.type === 'client' || contact.type === 'both')
    .map((contact) => ({
      id: contact.id,
      label: contact.company_name
        ? `${contact.company_name} — ${contact.contact_name}`
        : contact.contact_name,
    }))

  const items = (lineItems ?? []).map((item) => ({
    key: item.id,
    description: item.description,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    tax_rate: Number(item.tax_rate),
    discount: Number(item.discount),
  }))

  return (
    <PageBody className="pt-2">
      <div className="pb-4">
        <Link
          href={`${base}/${params.documentId}`}
          className="label-meta text-faint transition-colors hover:text-muted-foreground"
        >
          &larr; {doc.doc_number}
        </Link>
        <h1 className="pt-2 text-base font-semibold tracking-tight">Edit {doc.doc_number}</h1>
      </div>

      <DocumentForm
        scope={params}
        docType={docType}
        docSegment={params.docSegment}
        workspaceId={doc.workspace_id}
        contacts={contactOptions}
        projects={projects ?? []}
        locale={locale}
        values={{
          id: params.documentId,
          contactId: doc.contact_id,
          projectId: doc.project_id,
          issueDate: doc.issue_date,
          dueDate: doc.due_date,
          validUntil: doc.valid_until,
          currency: doc.currency,
          notes: doc.notes,
          terms: doc.terms,
          lineItems: items.length > 0 ? items : [blankLine()],
        }}
      />
    </PageBody>
  )
}
