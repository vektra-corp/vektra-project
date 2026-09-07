import { COMMERCIAL_STATUSES, type CommercialDocType } from '@pm/shared/constants'
import { formatCurrency, formatDate, publicIdToString } from '@pm/shared/utils'
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
  /** 16-digit public id — this row exists to be linked to. */
  id: string
  docNumber: string
  status: string
  issueDate: string
  validUntil: string | null
  grandTotal: number
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
      `public_id, doc_number, status, issue_date, valid_until, grand_total, currency,
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
      id: publicIdToString(doc.public_id),
      docNumber: doc.doc_number,
      status: doc.status,
      issueDate: doc.issue_date,
      validUntil: doc.valid_until,
      grandTotal: Number(doc.grand_total),
      currency: doc.currency,
      contactName: contact?.company_name ?? contact?.contact_name ?? null,
    }
  })

  const base = `/${params.orgSlug}/${params.workspaceSlug}/commercial/${params.docSegment}`
  const labels = DOC_TYPE_LABELS[docType]
  // Everything still open, which for a quotation means sent or seen but not yet
  // answered — the closest thing to a pipeline figure the list can show.
  const pipeline = rows
    .filter((row) => row.status === 'sent' || row.status === 'viewed')
    .reduce((sum, row) => sum + row.grandTotal, 0)

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
      key: 'validUntil',
      header: 'Valid until',
      headClassName: 'w-28',
      cell: (row) => (
        <span className="label-meta text-faint">
          {row.validUntil
            ? formatDate(row.validUntil, { locale, dateFormat: 'YYYY-MM-DD' })
            : '—'}
        </span>
      ),
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

  // The design opens the section with four figures over the table. They are
  // derived from the rows already loaded rather than counted again server-side:
  // the list is capped at 200, and a tile that disagreed with the table under it
  // would be worse than one that is explicitly "of what is shown".
  const accepted = rows
    .filter((row) => row.status === 'accepted')
    .reduce((sum, row) => sum + row.grandTotal, 0)
  const decided = rows.filter((row) => row.status === 'accepted' || row.status === 'rejected')
  const winRate = decided.length
    ? Math.round(
        (decided.filter((row) => row.status === 'accepted').length / decided.length) * 100,
      )
    : null

  const tiles = [
    { label: 'Open pipeline', value: formatCurrency(pipeline, auth.orgCurrency, locale), tone: 'text-foreground' },
    { label: 'Accepted', value: formatCurrency(accepted, auth.orgCurrency, locale), tone: 'text-primary' },
    { label: 'Win rate', value: winRate === null ? '—' : `${winRate}%`, tone: 'text-status-review' },
    { label: labels.plural, value: String(rows.length), tone: 'text-foreground' },
  ]

  return (
    <>
      <div className="border-border flex shrink-0 flex-wrap items-center gap-4 border-b px-5 py-2.5">
        <nav className="flex flex-wrap items-center gap-0.5" aria-label="Filter by status">
          <Link
            href={base}
            className={`rounded-[6px] px-[9px] py-1 text-nav transition-colors ${
              searchParams.status
                ? 'text-faint hover:text-foreground'
                : 'bg-surface-hover text-foreground font-medium'
            }`}
          >
            All
          </Link>
          {(COMMERCIAL_STATUSES[docType] as readonly string[]).map((status) => (
            <Link
              key={status}
              href={`${base}?status=${status}`}
              className={`rounded-[6px] px-[9px] py-1 text-nav capitalize transition-colors ${
                searchParams.status === status
                  ? 'bg-surface-hover text-foreground font-medium'
                  : 'text-faint hover:text-foreground'
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

      <PageBody className="p-0">
        <div className="grid grid-cols-2 gap-3 px-5 py-4 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="border-border bg-card flex flex-col gap-1.5 rounded-[11px] border px-[15px] py-[13px]"
            >
              <span className="label-meta-lg text-subtle">{tile.label}</span>
              <span
                className={`text-[20px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${tile.tone}`}
              >
                {tile.value}
              </span>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="border-border mx-5 flex flex-col items-center rounded-lg border border-dashed py-16 text-center">
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
