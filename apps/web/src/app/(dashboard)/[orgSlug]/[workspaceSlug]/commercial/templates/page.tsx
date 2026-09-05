import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { parsePdfTemplate } from '@pm/shared/constants'
import type { Metadata } from 'next'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { NewTemplateDialog } from './new-template-dialog'
import { TemplateEditor, type TemplateRecord } from './template-editor'

export const metadata: Metadata = { title: 'PDF templates' }

/**
 * PDF template editor (§4, §6.4).
 *
 * The `pdf_templates` table has existed since 00004 but nothing wrote to it, so
 * every document rendered with the same hard-coded layout. A template now
 * controls the document's typography, colours, page size, which line-item
 * columns appear and which sections are included.
 *
 * What it deliberately does not do is free positioning. That is a much larger
 * surface, and a template that can place an element anywhere is a template that
 * can silently produce a blank invoice.
 */
export default async function TemplatesPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const supabase = createClient()
  const { data: templates } = await supabase
    .from('pdf_templates')
    .select('id, name, doc_type, is_default, template_data')
    .eq('organization_id', auth.orgId)
    .order('doc_type')
    .order('name')

  const records: TemplateRecord[] = (templates ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    docType: row.doc_type,
    isDefault: row.is_default,
    template: parsePdfTemplate(row.template_data),
  }))

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[
          {
            label: 'Commercial',
            href: `/${params.orgSlug}/${params.workspaceSlug}/commercial`,
          },
          { label: 'PDF templates' },
        ]}
      />

      <PageBody className="pt-4">
        <div className="space-y-6 pb-10">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight">PDF templates</h1>
              <p className="pt-1 text-base text-muted-foreground">
                How generated documents look. A document uses its own template if it has
                one, otherwise the default for its type.
              </p>
            </div>
            <NewTemplateDialog scope={params} />
          </div>

          {records.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-base text-muted-foreground">
              No templates yet. Documents render with the built-in layout until you add one.
            </p>
          ) : (
            records.map((record) => (
              <section key={record.id} className="space-y-3">
                <h2 className="text-ui font-semibold">
                  {record.name}
                  <span className="label-meta ps-2 text-faint">
                    {record.docType.replace('_', ' ')}
                  </span>
                </h2>
                <TemplateEditor scope={params} template={record} />
              </section>
            ))
          )}
        </div>
      </PageBody>
    </>
  )
}
