import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import { can } from '@pm/auth/rbac'
import { describeSchedule, parseSchedule } from '@pm/shared/constants'
import { Badge } from '@pm/ui'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageBody } from '@/components/layout/page-body'
import { Topbar } from '@/components/layout/topbar'
import { requireAuthPage } from '@/lib/auth/context'
import { forbidden } from '@/lib/forbidden'
import { createClient } from '@/lib/supabase/server'
import { DeleteWorkflowButton, WebhookTrigger, WorkflowEditor } from '../workflow-controls'

export const metadata: Metadata = { title: 'Workflow' }

export default async function WorkflowPage({
  params,
}: {
  params: { orgSlug: string; workspaceSlug: string; workflowId: string }
}) {
  const auth = await requireAuthPage(params.orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) forbidden()

  const supabase = createClient()

  const [{ data: workflow }, { data: runs }] = await Promise.all([
    supabase
      .from('workflows')
      .select(
        'id, name, description, is_active, trigger_type, graph, webhook_token_hash, cron_expression, trigger_config, run_count',
      )
      .eq('id', params.workflowId)
      .eq('organization_id', auth.orgId)
      .maybeSingle(),
    supabase
      .from('workflow_runs')
      .select('id, status, started_at, duration_ms, error')
      .eq('workflow_id', params.workflowId)
      .order('started_at', { ascending: false })
      .limit(10),
  ])

  if (!workflow) notFound()

  const base = `/${params.orgSlug}/${params.workspaceSlug}/workflows`
  const canEdit = can(auth, 'workflows', 'update')

  return (
    <>
      <Topbar
        orgSlug={params.orgSlug}
        breadcrumb={[{ label: 'Workflows', href: base }, { label: workflow.name }]}
        meta={
          <Badge variant={workflow.is_active ? 'success' : 'secondary'} shape="meta" className="ms-1">
            {workflow.is_active ? 'Active' : 'Paused'}
          </Badge>
        }
      />

      <PageBody className="pt-2">
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight">{workflow.name}</h1>
              {workflow.description ? (
                <p className="pt-1 text-base text-muted-foreground">{workflow.description}</p>
              ) : null}
            </div>
            {canEdit ? (
              <DeleteWorkflowButton
                scope={params}
                workflowId={workflow.id}
                name={workflow.name}
              />
            ) : null}
          </div>

          {workflow.trigger_type === 'webhook' ? (
            <WebhookTrigger
              scope={params}
              workflowId={workflow.id}
              hasToken={Boolean(workflow.webhook_token_hash)}
              canEdit={canEdit}
            />
          ) : null}

          {workflow.trigger_type === 'schedule' ? (
            <p className="rounded-lg border border-border-subtle bg-surface px-4 py-2.5 text-nav">
              <span className="label-meta pe-2 text-faint">Schedule</span>
              <span className="text-muted-foreground">
                {describeSchedule(parseSchedule((workflow.trigger_config as { schedule?: unknown })?.schedule))}
              </span>
              <code className="ps-2 font-mono text-[11px] text-faint">
                {workflow.cron_expression}
              </code>
            </p>
          ) : null}

          <WorkflowEditor
            scope={params}
            workflowId={workflow.id}
            initialGraph={workflow.graph}
            isActive={workflow.is_active}
            canEdit={canEdit}
          />

          <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <header className="border-b border-border-subtle px-4 py-2.5">
              <h2 className="label-meta text-faint">Recent runs</h2>
            </header>
            {!runs?.length ? (
              <p className="px-4 py-8 text-center text-base text-faint">
                This workflow has not run yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {runs.map((run) => (
                  <li key={run.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Badge
                      variant={
                        run.status === 'completed'
                          ? 'success'
                          : run.status === 'running'
                            ? 'secondary'
                            : 'destructive'
                      }
                      shape="meta"
                    >
                      {run.status}
                    </Badge>
                    <span className="label-meta flex-1 truncate text-faint">
                      {run.error ?? run.started_at}
                    </span>
                    {run.duration_ms ? (
                      <span className="label-meta tabular-nums text-faint">
                        {run.duration_ms}ms
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-nav text-faint">
            Active workflows are dispatched every couple of minutes from the event log. Delays,
            task creation and outbound webhooks are recorded as skipped — those actions are not
            implemented yet.{' '}
            <Link href={base} className="text-primary hover:underline">
              All workflows
            </Link>
          </p>
        </div>
      </PageBody>
    </>
  )
}
