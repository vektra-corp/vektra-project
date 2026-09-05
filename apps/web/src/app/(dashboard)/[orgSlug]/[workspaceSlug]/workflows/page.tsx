import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { parseGraph, validateGraph } from '@pm/shared/constants'
import { formatRelativeTime } from '@pm/shared/utils'
import { Badge } from '@pm/ui'
import { Split } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLocale } from 'next-intl/server'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { NewWorkflowDialog } from './workflow-controls'

export const metadata: Metadata = { title: 'Workflows' }

const TRIGGER_LABELS: Record<string, string> = {
  task_event: 'Task change',
  subtask_event: 'Subtask change',
  commercial_event: 'Commercial change',
  webhook: 'Webhook',
  schedule: 'Schedule',
  manual: 'Manual',
}

export default async function WorkflowsPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const locale = await getLocale()
  const supabase = createClient()

  const { data: workflows } = await supabase
    .from('workflows')
    .select('id, name, description, is_active, trigger_type, graph, run_count, last_run_at')
    .eq('organization_id', auth.orgId)
    .order('name')

  const base = `/${params.orgSlug}/${params.workspaceSlug}/workflows`

  return (
    <>
      <Topbar orgSlug={params.orgSlug} breadcrumb={[{ label: 'Workflows' }]} />

      <div className="flex items-center gap-3 px-5 py-3">
        <p className="text-base text-muted-foreground">
          Run actions automatically when something happens.
        </p>
        <div className="ms-auto">
          <NewWorkflowDialog scope={params} />
        </div>
      </div>

      <PageBody>
        {!workflows?.length ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16 text-center">
            <Split className="h-6 w-6 text-faint" aria-hidden />
            <p className="pt-3 text-base text-muted-foreground">No workflows yet.</p>
            <p className="pt-1 max-w-sm text-nav text-faint">
              A workflow reacts to an event, checks a condition, and does something.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {workflows.map((workflow) => {
              // The list shows validity so a paused-because-broken workflow is
              // distinguishable from one paused on purpose.
              const problems = validateGraph(parseGraph(workflow.graph))

              return (
                <li key={workflow.id}>
                  <Link
                    href={`${base}/${workflow.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover/50"
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        workflow.is_active ? 'bg-success' : 'bg-faint'
                      }`}
                      aria-hidden
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium">{workflow.name}</p>
                      <p className="label-meta pt-1 text-faint">
                        {TRIGGER_LABELS[workflow.trigger_type] ?? workflow.trigger_type}
                        <span className="px-1.5 opacity-50">·</span>
                        {workflow.run_count} runs
                        {workflow.last_run_at ? (
                          <>
                            <span className="px-1.5 opacity-50">·</span>
                            last {formatRelativeTime(workflow.last_run_at, locale)}
                          </>
                        ) : null}
                      </p>
                    </div>

                    {problems.length > 0 ? (
                      <Badge variant="destructive" shape="meta">
                        {problems.length} problem{problems.length === 1 ? '' : 's'}
                      </Badge>
                    ) : null}

                    <Badge variant={workflow.is_active ? 'success' : 'secondary'} shape="meta">
                      {workflow.is_active ? 'Active' : 'Paused'}
                    </Badge>
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
