import { can } from '@pm/auth/rbac'
import { formatRelativeTime, initials, publicIdToString } from '@pm/shared/utils'
import { Avatar, AvatarFallback, AvatarImage, Badge } from '@pm/ui'
import { FileText } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { ProjectViewTabs } from '@/components/projects/project-tabs'
import { requireAuthPage } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'
import { NewDocumentDialog } from './new-document-dialog'

export const metadata: Metadata = { title: 'Documents' }

const STATUS_VARIANT: Record<string, 'secondary' | 'success' | 'outline'> = {
  draft: 'secondary',
  published: 'success',
  archived: 'outline',
}

export default async function DocumentsPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; projectId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)

  const project = await resolveProject(params.projectId)
  if (!project) notFound()

  const locale = await getLocale()
  const supabase = createClient()

  const { data: documents } = await supabase
    .from('documents')
    .select(
      `id, public_id, title, status, version, updated_at,
       author:profiles!documents_created_by_fkey(id, full_name, avatar_url)`,
    )
    .eq('project_id', project.id)
    .order('updated_at', { ascending: false })

  const base = `/${params.orgSlug}/${params.workspaceSlug}/projects/${params.projectId}`
  const canCreate = can(auth, 'tasks', 'create')

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <ProjectViewTabs base={base} />
        <p className="label-meta ms-auto text-faint">{documents?.length ?? 0} documents</p>
        {canCreate ? <NewDocumentDialog scope={params} /> : null}
      </div>

      <PageBody>
        {!documents?.length ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <FileText className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-base text-muted-foreground">No documents in this project.</p>
            <p className="pt-1 text-nav text-faint">
              Specs, decisions and notes that outlive a single task.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {documents.map((document) => {
              // PostgREST returns a to-one embed as an object; the generated
              // types allow an array, so normalise rather than casting blindly.
              const author = Array.isArray(document.author) ? document.author[0] : document.author

              return (
                <li key={document.id}>
                  <Link
                    href={`${base}/documents/${publicIdToString(document.public_id)}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover/50"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-faint" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-base font-medium">
                      {document.title}
                    </span>

                    <Badge variant={STATUS_VARIANT[document.status] ?? 'secondary'} shape="meta">
                      {document.status}
                    </Badge>
                    <span className="label-meta w-10 text-end text-faint">v{document.version}</span>

                    {author ? (
                      <Avatar className="h-5 w-5" title={author.full_name}>
                        {author.avatar_url ? <AvatarImage src={author.avatar_url} alt="" /> : null}
                        <AvatarFallback className="bg-surface-hover text-[9px] font-medium uppercase text-muted-foreground">
                          {initials(author.full_name)}
                        </AvatarFallback>
                      </Avatar>
                    ) : null}

                    <span className="label-meta w-24 shrink-0 text-end text-faint">
                      {formatRelativeTime(document.updated_at, locale)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </PageBody>
    </>
  )
}
