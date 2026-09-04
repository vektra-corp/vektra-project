import { can } from '@pm/auth/rbac'
import { formatDate } from '@pm/shared/utils'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageBody } from '@/components/layout/page-body'
import { requireAuthPage } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'
import { DocumentEditor } from './document-editor'
import { VersionHistory, type VersionRow } from './version-history'

export const metadata: Metadata = { title: 'Document' }

export default async function DocumentPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string; documentId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  const supabase = createClient()

  const [{ data: document }, { data: versions }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, title, content, status, version')
      .eq('id', params.documentId)
      .maybeSingle(),
    supabase
      .from('document_versions')
      .select(
        'id, version, content, created_at, editor:profiles!document_versions_edited_by_fkey(full_name)',
      )
      .eq('document_id', params.documentId)
      .order('version', { ascending: false })
      .limit(20),
  ])

  // RLS returns nothing for a document in another tenant, which is the same
  // observable outcome as one that does not exist. That is deliberate.
  if (!document) notFound()

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`

  const history: VersionRow[] = (versions ?? []).map((row) => {
    const editor = Array.isArray(row.editor) ? row.editor[0] : row.editor
    return {
      id: row.id,
      version: row.version,
      content: row.content,
      createdAt: formatDate(row.created_at, { locale: 'en', dateFormat: 'YYYY-MM-DD' }),
      editorName: editor?.full_name ?? 'Unknown',
    }
  })

  return (
    <PageBody className="pt-3">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-3">
          <Link
            href={`${base}/documents`}
            className="label-meta text-faint transition-colors hover:text-muted-foreground"
          >
            &larr; All documents
          </Link>

          <DocumentEditor
            scope={params}
            document={document}
            canEdit={can(auth, 'tasks', 'update')}
            canDelete={can(auth, 'tasks', 'delete')}
          />
        </div>

        <VersionHistory
          scope={params}
          documentId={document.id}
          versions={history}
          currentVersion={document.version}
          canRestore={can(auth, 'tasks', 'update')}
        />
      </div>
    </PageBody>
  )
}
