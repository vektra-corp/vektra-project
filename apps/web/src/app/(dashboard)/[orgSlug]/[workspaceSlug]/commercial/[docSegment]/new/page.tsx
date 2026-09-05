import { formatDate } from '@pm/shared/utils'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { DOC_TYPE_LABELS, SEGMENT_TO_DOC_TYPE } from '../../doc-types'
import { DocumentForm } from '../../document-form'
import { blankLine } from '../../line-item-editor'

export const metadata: Metadata = { title: 'New document' }

export default async function NewCommercialDocPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; docSegment: string }
}) {
  const docType = SEGMENT_TO_DOC_TYPE[params.docSegment]
  if (!docType) notFound()

  const auth = await requireAuthPage(params.orgSlug)
  const locale = await getLocale()
  const supabase = createClient()

  const [{ data: workspace }, { data: contacts }, { data: projects }] = await Promise.all([
    supabase
      .from('workspaces')
      .select('id')
      .eq('organization_id', auth.orgId)
      .eq('slug', params.workspaceSlug)
      .maybeSingle(),
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

  if (!workspace) notFound()

  // A purchase order or bill goes to a vendor; everything else to a client.
  const wanted = docType === 'purchase_order' || docType === 'bill' ? 'vendor' : 'client'
  const contactOptions = (contacts ?? [])
    .filter((contact) => contact.type === wanted || contact.type === 'both')
    .map((contact) => ({
      id: contact.id,
      label: contact.company_name
        ? `${contact.company_name} — ${contact.contact_name}`
        : contact.contact_name,
    }))

  return (
    <PageBody className="pt-2">
      <div className="pb-4">
        <h1 className="text-base font-semibold tracking-tight">
          New {DOC_TYPE_LABELS[docType].singular.toLowerCase()}
        </h1>
        <p className="pt-1 text-base text-muted-foreground">
          Saved as a draft. The number is assigned now and never reused.
        </p>
      </div>

      <DocumentForm
        scope={params}
        docType={docType}
        docSegment={params.docSegment}
        workspaceId={workspace.id}
        contacts={contactOptions}
        projects={projects ?? []}
        locale={locale}
        values={{
          contactId: null,
          projectId: null,
          issueDate: formatDate(new Date(), { locale: 'en', dateFormat: 'YYYY-MM-DD' }),
          dueDate: null,
          validUntil: null,
          currency: auth.orgCurrency,
          notes: null,
          terms: null,
          lineItems: [blankLine()],
        }}
      />
    </PageBody>
  )
}
