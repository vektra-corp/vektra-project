import { COMMERCIAL_STATUSES, type CommercialDocType } from '@pm/shared/constants'
import { formatCurrency, formatDate } from '@pm/shared/utils'
import { Badge, Button, DataTable, type DataTableColumn } from '@pm/ui'
import { FileText, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { DOC_TYPE_LABELS, SEGMENT_TO_DOC_TYPE, statusVariant } from '../doc-types'

export const metadata: Metadata = { title: 'Commercial' }

interface Row {
  id: string
  docNumber: string
  status: string
  issueDate: string
  dueDate: string | null
  validUntil: string | null
  grandTotal: number
  amountPaid: number
  currency: string
  contactName: string | null
}

export default async function CommercialListPage({
  params,
  searchParams,
}: {
  params: { orgSlug: string; workspaceSlug: string; docSegment: string }
  searchParams: { status?: string }
}) {
  const docType: CommercialDocType | undefined = SEGMENT_TO_DOC_TYPE[params.docSegment]
  // An unknown segment is a 404, not an empty list of nothing in particular.
  if (!docType) notFound()

  const auth = await requireAuthPage(params.orgSlug)
  const locale = await getLocale()
  const supabase = createClient()

  let query = supabase
    .from('commercial_documents')
    .select(
      `id, doc_number, status, issue_date, due_date, valid_until, grand_total, amount_paid, currency,
       contact:contacts!commercial_documents_contact_id_fkey(contact_name, company_name)`,
    )
    .eq('organization_id', auth.orgId)
    .eq('doc_type', docType)
    .order('issue_date', { ascending: false })
    .limit(200)

  if (searchParams.status) query = query.eq('status', searchParams.status)

  const { data: documents } = await query

  const rows: Row[] = (documents ?? []).map((doc) => {
    // PostgREST returns a to-one embed as an object; the generated types allow
    // an array, so normalise rather than casting blindly.
    const contact = Array.isArray(doc.contact) ? doc.contact[0] : doc.contact
    return {
      id: doc.id,
      docNumber: doc.doc_number,
      status: doc.status,
      issueDate: doc.issue_date,
      dueDate: doc.due_date,
      validUntil: doc.valid_until,
      grandTotal: Number(doc.grand_total),
      amountPaid: Number(doc.amount_paid),
      currency: doc.currency,
      contactName: contact?.company_name ?? contact?.contact_name ?? null,
    }
  })

  const base = `/${params.orgSlug}/${params.workspaceSlug}/commercial/${params.docSegment}`
  const labels = DOC_TYPE_LABELS[docType]
  const takesPayment = docType === 'invoice' || docType === 'bill'

  const outstanding = rows
    .filter((row) => !['paid', 'void', 'closed'].includes(row.status))
    .reduce((sum, row) => sum + (row.grandTotal - row.amountPaid), 0)

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'number',
      header: 'Number',
      headClassName: 'w-36',
      cell: (row) => (
        <Link href={`${base}/${row.id}`} className="label-meta transition-colors hover:text-primary">
          {row.docNumber}
        </Link>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      cell: (row) => (
        <span className="truncate text-base">
          {row.contactName ?? <span className="text-faint">No contact</span>}
        </span>
      ),
    },
    {
      key: 'issued',
      header: 'Issued',
      headClassName: 'w-28',
      cell: (row) => (
        <span className="label-meta text-faint">
          {formatDate(row.issueDate, { locale, dateFormat: 'YYYY-MM-DD' })}
        </span>
      ),
    },
    {
      key: 'due',
      header: docType === 'quotation' ? 'Valid until' : 'Due',
      headClassName: 'w-28',
      cell: (row) => {
        const value = docType === 'quotation' ? row.validUntil : row.dueDate
        return (
          <span className="label-meta text-faint">
            {value ? formatDate(value, { locale, dateFormat: 'YYYY-MM-DD' }) : '—'}
          </span>
        )
      },
    },
    {
      key: 'total',
      header: 'Total',
      headClassName: 'w-32 text-end',
      className: 'text-end',
      cell: (row) => (
        <span className="text-base tabular-nums">
          {formatCurrency(row.grandTotal, row.currency, locale)}
        </span>
      ),
    },
    ...(takesPayment
      ? [
          {
            key: 'outstanding',
            header: 'Outstanding',
            headClassName: 'w-32 text-end',
            className: 'text-end',
            cell: (row: Row) => {
              const owed = row.grandTotal - row.amountPaid
              return (
                <span
                  className={`text-base tabular-nums ${owed > 0 ? 'text-warning' : 'text-faint'}`}
                >
                  {formatCurrency(owed, row.currency, locale)}
                </span>
              )
            },
          },
        ]
      : []),
    {
      key: 'status',
      header: 'Status',
      headClassName: 'w-36',
      cell: (row) => (
        <Badge variant={statusVariant(row.status)} shape="meta">
          {row.status.replace('_', ' ')}
        </Badge>
      ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 pb-3">
        <p className="text-base text-muted-foreground">
          {rows.length} {rows.length === 1 ? labels.singular.toLowerCase() : labels.plural.toLowerCase()}
        </p>

        {takesPayment && outstanding > 0 ? (
          <p className="label-meta text-warning">
            {formatCurrency(outstanding, auth.orgCurrency, locale)} outstanding
          </p>
        ) : null}

        <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by status">
          <Link
            href={base}
            className={`label-meta rounded px-1.5 py-1 transition-colors ${
              searchParams.status ? 'text-faint hover:text-muted-foreground' : 'bg-surface-hover text-foreground'
            }`}
          >
            All
          </Link>
          {(COMMERCIAL_STATUSES[docType] as readonly string[]).map((status) => (
            <Link
              key={status}
              href={`${base}?status=${status}`}
              className={`label-meta rounded px-1.5 py-1 transition-colors ${
                searchParams.status === status
                  ? 'bg-surface-hover text-foreground'
                  : 'text-faint hover:text-muted-foreground'
              }`}
            >
              {status.replace('_', ' ')}
            </Link>
          ))}
        </nav>

        <Button asChild size="sm" className="ms-auto">
          <Link href={`${base}/new`}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New {labels.singular.toLowerCase()}
          </Link>
        </Button>
      </div>

      <PageBody>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <FileText className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-base text-muted-foreground">
              {searchParams.status
                ? `No ${labels.plural.toLowerCase()} with that status.`
                : `No ${labels.plural.toLowerCase()} yet.`}
            </p>
          </div>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />
        )}
      </PageBody>
    </>
  )
}
