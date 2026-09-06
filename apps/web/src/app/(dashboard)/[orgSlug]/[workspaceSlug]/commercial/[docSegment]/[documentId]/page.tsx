import { can } from '@pm/auth/rbac'
import type { CommercialDocType } from '@pm/shared/constants'
import { formatCurrency, formatDate, publicIdToString } from '@pm/shared/utils'
import { Badge, Button } from '@pm/ui'
import { FileDown, Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { CustomFieldInputs } from '@/components/custom-fields/custom-field-inputs'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { loadCustomFields } from '@/lib/custom-fields'
import { resolveCommercialDoc } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'
import { DOC_TYPE_LABELS, SEGMENT_TO_DOC_TYPE, statusVariant } from '../../doc-types'
import { DocumentActions } from '../../document-actions'

export const metadata: Metadata = { title: 'Document' }

export default async function CommercialDocPage({
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

  const [{ data: doc }, { data: lineItems }] = await Promise.all([
    supabase
      .from('commercial_documents')
      .select(
        `id, doc_type, doc_number, status, issue_date, due_date, valid_until, currency,
         subtotal, tax_total, discount_total, grand_total, notes, terms,
         contact:contacts!commercial_documents_contact_id_fkey(contact_name, company_name, email),
         project:projects!commercial_documents_project_id_fkey(public_id, name)`,
      )
      .eq('id', resolved.id)
      .eq('organization_id', auth.orgId)
      .maybeSingle(),
    supabase
      .from('commercial_line_items')
      .select('id, description, quantity, unit_price, tax_rate, discount, line_total')
      .eq('document_id', resolved.id)
      .order('position'),
  ])

  // RLS returns nothing for another tenant's document, which is the same
  // observable outcome as one that does not exist. That is deliberate.
  if (!doc || doc.doc_type !== docType) notFound()

  const custom = await loadCustomFields(supabase, auth.orgId, 'commercial_document', doc.id)
  const canEditDoc = can(auth, 'commercial', 'update')

  const contact = Array.isArray(doc.contact) ? doc.contact[0] : doc.contact
  const project = Array.isArray(doc.project) ? doc.project[0] : doc.project

  const base = `/${params.orgSlug}/${params.workspaceSlug}/commercial/${params.docSegment}`
  const money = (value: number) => formatCurrency(Number(value), doc.currency, locale)
  const date = (value: string) => formatDate(value, { locale, dateFormat: 'YYYY-MM-DD' })

  const editable = doc.status === 'draft'

  return (
    <PageBody className="pt-2">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <Link
            href={base}
            className="label-meta text-faint transition-colors hover:text-muted-foreground"
          >
            &larr; {DOC_TYPE_LABELS[docType].plural}
          </Link>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <h1 className="text-head font-semibold tracking-tight">{doc.doc_number}</h1>
            <Badge variant={statusVariant(doc.status)} shape="meta">
              {doc.status.replace('_', ' ')}
            </Badge>

            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Button asChild variant="subtle" size="sm">
                {/* Opens in a new tab: the response is a PDF, so navigating the
                    current tab would replace the page with a file viewer. */}
                <a
                  href={`/api/commercial/${params.documentId}/pdf?org=${params.orgSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileDown className="h-3 w-3" aria-hidden />
                  PDF
                </a>
              </Button>

              {editable && can(auth, 'commercial', 'update') ? (
                <Button asChild variant="subtle" size="sm">
                  <Link href={`${base}/${params.documentId}/edit`}>
                    <Pencil className="h-3 w-3" aria-hidden />
                    Edit
                  </Link>
                </Button>
              ) : null}

              <DocumentActions
                scope={params}
                documentId={params.documentId}
                docType={docType as CommercialDocType}
                docSegment={params.docSegment}
                status={doc.status}
                canDelete={can(auth, 'commercial', 'delete')}
              />
            </div>
          </div>

        </div>

        <dl className="grid gap-4 rounded-lg border border-border bg-surface p-5 shadow-card sm:grid-cols-3">
          <Fact
            label="Client"
            value={contact ? (contact.company_name ?? contact.contact_name) : '—'}
          />
          <Fact label="Issued" value={date(doc.issue_date)} />
          <Fact label="Valid until" value={doc.valid_until ? date(doc.valid_until) : '—'} />
          {project ? (
            <Fact
              label="Project"
              value={
                <Link
                  href={`/${params.orgSlug}/${params.workspaceSlug}/projects/${publicIdToString(project.public_id)}/board`}
                  className="text-primary hover:underline"
                >
                  {project.name}
                </Link>
              }
            />
          ) : null}
        </dl>

        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <div className="scrollbar-slim overflow-x-auto">
            <table className="w-full min-w-[520px] text-ui">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="label-meta px-4 py-2 text-start text-faint">Description</th>
                  <th className="label-meta w-20 px-3 py-2 text-end text-faint">Qty</th>
                  <th className="label-meta w-28 px-3 py-2 text-end text-faint">Price</th>
                  <th className="label-meta w-20 px-3 py-2 text-end text-faint">Tax</th>
                  <th className="label-meta w-32 px-4 py-2 text-end text-faint">Total</th>
                </tr>
              </thead>
              <tbody>
                {!lineItems?.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-base text-faint">
                      No line items.
                    </td>
                  </tr>
                ) : (
                  lineItems.map((item) => (
                    <tr key={item.id} className="border-b border-border-subtle last:border-0">
                      <td className="px-4 py-2.5 text-base">{item.description}</td>
                      <td className="px-3 py-2.5 text-end text-base tabular-nums">
                        {item.quantity}
                      </td>
                      <td className="px-3 py-2.5 text-end text-base tabular-nums">
                        {money(Number(item.unit_price))}
                      </td>
                      <td className="px-3 py-2.5 text-end text-base tabular-nums text-muted-foreground">
                        {Number(item.tax_rate)}%
                      </td>
                      <td className="px-4 py-2.5 text-end text-base tabular-nums">
                        {money(Number(item.line_total))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <dl className="space-y-1.5 border-t border-border-subtle px-4 py-4">
            <Row label="Subtotal" value={money(Number(doc.subtotal))} />
            {Number(doc.discount_total) > 0 ? (
              <Row label="Discount" value={`−${money(Number(doc.discount_total))}`} />
            ) : null}
            <Row label="Tax" value={money(Number(doc.tax_total))} />
            <div className="border-t border-border-subtle pt-1.5">
              <Row label="Total" value={money(Number(doc.grand_total))} emphasis />
            </div>
          </dl>
        </div>

        {doc.notes || doc.terms ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {doc.notes ? (
              <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <p className="label-meta pb-2 text-faint">Notes</p>
                <p className="whitespace-pre-wrap text-base text-muted-foreground">{doc.notes}</p>
              </div>
            ) : null}
            {doc.terms ? (
              <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <p className="label-meta pb-2 text-faint">Terms</p>
                <p className="whitespace-pre-wrap text-base text-muted-foreground">{doc.terms}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {custom.fields.length > 0 ? (
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
            <p className="label-meta pb-3 text-faint">Custom fields</p>
            <CustomFieldInputs
              orgSlug={params.orgSlug}
              entityType="commercial_document"
              entityId={doc.id}
              fields={custom.fields}
              values={custom.values}
              canEdit={canEditDoc}
            />
          </div>
        ) : null}
      </div>
    </PageBody>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="label-meta text-faint">{label}</dt>
      <dd className="pt-1.5 text-base">{value}</dd>
    </div>
  )
}

function Row({
  label,
  value,
  emphasis = false,
  tone,
}: {
  label: string
  value: string
  emphasis?: boolean
  tone?: 'warning' | 'success'
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={`label-meta ${emphasis ? 'text-muted-foreground' : 'text-faint'}`}>{label}</dt>
      <dd
        className={`tabular-nums ${
          emphasis ? 'text-ui font-semibold' : 'text-base'
        } ${tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : ''}`}
      >
        {value}
      </dd>
    </div>
  )
}
