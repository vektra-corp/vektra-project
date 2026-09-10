import 'server-only'

import {
  createTask,
  planExecution,
  triggerMatches,
  type PlannedStep,
  type TriggerEvent,
} from '@pm/db'
import type { Database } from '@pm/db/types'
import { parseGraph, type WorkflowNode } from '@pm/shared/constants'
import type { SupabaseClient } from '@supabase/supabase-js'
import { callWebhook } from './webhook-call'

type Db = SupabaseClient<Database>

/**
 * Workflow action execution (§11).
 *
 * The walk is decided by `planExecution` in @pm/db; this performs the effects
 * and records what happened. Actions are deliberately narrow — each one writes a
 * specific thing, and an action type with no implementation is logged as
 * skipped rather than failing the whole run, so one unimplemented node does not
 * take an otherwise working workflow down.
 */

export interface WorkflowRow {
  id: string
  organization_id: string
  workspace_id: string
  name: string
  trigger_type: string
  trigger_config: unknown
  graph: unknown
}

interface StepResult {
  status: 'success' | 'failed' | 'skipped'
  output?: Record<string, unknown>
  error?: string
}

/** The row the event is about, when it is a task. */
function subjectId(payload: Record<string, unknown>): string | null {
  const row = (payload.new ?? payload.old) as Record<string, unknown> | undefined
  const id = row?.id
  return typeof id === 'string' ? id : null
}

async function performAction(
  db: Db,
  workflow: WorkflowRow,
  node: WorkflowNode,
  payload: Record<string, unknown>,
): Promise<StepResult> {
  const taskId = subjectId(payload)

  switch (node.action_type) {
    case 'update_fields': {
      if (!taskId) return { status: 'skipped', error: 'No task in the trigger payload' }
      const field = typeof node.config.field === 'string' ? node.config.field : ''
      const value = node.config.value

      // An arbitrary column name from a config blob is a write primitive; only
      // the fields a workflow is meant to touch are allowed.
      const allowed = ['status', 'priority', 'is_milestone']
      if (!allowed.includes(field)) {
        return { status: 'skipped', error: `Field "${field}" is not updatable by a workflow` }
      }

      const { error } = await db
        .from('tasks')
        .update({ [field]: value } as never)
        .eq('id', taskId)
        .eq('organization_id', workflow.organization_id)

      return error ? { status: 'failed', error: error.message } : { status: 'success' }
    }

    case 'assign_task': {
      if (!taskId) return { status: 'skipped', error: 'No task in the trigger payload' }
      const userId = typeof node.config.user_id === 'string' ? node.config.user_id : null
      if (!userId) return { status: 'skipped', error: 'No assignee configured' }

      // The assignee must be a member of this org, or the task becomes
      // invisible to the person it was just given to.
      const { data: member } = await db
        .from('org_members')
        .select('user_id')
        .eq('organization_id', workflow.organization_id)
        .eq('user_id', userId)
        .maybeSingle()

      if (!member) return { status: 'failed', error: 'Assignee is not a member of this org' }

      const { error } = await db
        .from('tasks')
        .update({ assignee_id: userId })
        .eq('id', taskId)
        .eq('organization_id', workflow.organization_id)

      return error ? { status: 'failed', error: error.message } : { status: 'success' }
    }

    case 'add_label': {
      if (!taskId) return { status: 'skipped', error: 'No task in the trigger payload' }
      const labelName = typeof node.config.label === 'string' ? node.config.label.trim() : ''
      if (!labelName) return { status: 'skipped', error: 'No label configured' }

      const { data: label } = await db
        .from('labels')
        .select('id')
        .eq('organization_id', workflow.organization_id)
        .eq('name', labelName)
        .maybeSingle()

      if (!label) return { status: 'failed', error: `No label named "${labelName}"` }

      const { error } = await db.from('task_labels').upsert(
        {
          task_id: taskId,
          label_id: label.id,
          // Denormalized for fast RLS checks (§2); every tenant row carries it.
          organization_id: workflow.organization_id,
        },
        { onConflict: 'task_id,label_id' },
      )

      return error ? { status: 'failed', error: error.message } : { status: 'success' }
    }

    case 'send_notification': {
      const userId = typeof node.config.user_id === 'string' ? node.config.user_id : null
      if (!userId) return { status: 'skipped', error: 'No recipient configured' }

      const { error } = await db.from('notifications').insert({
        organization_id: workflow.organization_id,
        user_id: userId,
        type: 'workflow',
        title: String(node.config.title ?? `Workflow: ${workflow.name}`).slice(0, 200),
        body: node.config.body ? String(node.config.body).slice(0, 1000) : null,
        data: { workflow_id: workflow.id, task_id: taskId },
      })

      return error ? { status: 'failed', error: error.message } : { status: 'success' }
    }

    case 'add_comment': {
      if (!taskId) return { status: 'skipped', error: 'No task in the trigger payload' }
      const text = typeof node.config.body === 'string' ? node.config.body.trim() : ''
      if (!text) return { status: 'skipped', error: 'No comment body configured' }

      // Since 00025 a comment records what kind of author it has, so a
      // workflow can write one without impersonating a person or needing a
      // fake member seat. It renders as "Automation".
      const { error } = await db.from('comments').insert({
        task_id: taskId,
        organization_id: workflow.organization_id,
        author_id: null,
        author_type: 'workflow',
        author_workflow_id: workflow.id,
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        } as never,
        // `is_internal` only ever hid a comment from external portal users.
        // With the portal removed there is no such reader, so an automated note
        // is an ordinary comment.
        is_internal: false,
      })

      return error ? { status: 'failed', error: error.message } : { status: 'success' }
    }

    case 'create_task': {
      const projectId = typeof node.config.project_id === 'string' ? node.config.project_id : ''
      const title = typeof node.config.title === 'string' ? node.config.title.trim() : ''
      if (!projectId) return { status: 'skipped', error: 'No project configured' }
      if (!title) return { status: 'skipped', error: 'No title configured' }

      // The project must belong to this workflow's org. The runner holds the
      // service role and so bypasses RLS — this check is the only thing
      // standing between a config blob and a cross-tenant write.
      const { data: project } = await db
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('organization_id', workflow.organization_id)
        .maybeSingle()

      if (!project) return { status: 'failed', error: 'Project is not in this organisation' }

      // Reuse the service rather than inserting directly: it allocates the
      // column and status together (§18 rule 3) and enforces the plan limit,
      // neither of which a workflow should get to bypass.
      try {
        const created = await createTask(db, {
          orgId: workflow.organization_id,
          userId: null,
          project_id: projectId,
          title: title.slice(0, 200),
          priority: typeof node.config.priority === 'string' ? node.config.priority : 'medium',
          assignee_id: typeof node.config.assignee_id === 'string' ? node.config.assignee_id : null,
        })
        return { status: 'success', output: { task_id: created.id } }
      } catch (error) {
        return { status: 'failed', error: error instanceof Error ? error.message : 'Create failed' }
      }
    }

    case 'call_webhook': {
      const url = typeof node.config.url === 'string' ? node.config.url : ''
      if (!url) return { status: 'skipped', error: 'No URL configured' }

      const outcome = await callWebhook(url, {
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        organization_id: workflow.organization_id,
        payload,
      })

      return outcome.ok
        ? { status: 'success', output: { status: outcome.status, body: outcome.body } }
        : { status: 'failed', error: outcome.reason }
    }

    default:
      return { status: 'skipped', error: 'No action type set' }
  }
}

/**
 * Claim a run for this (workflow, event).
 *
 * Returns null when the run already exists. The unique index from 00024 is what
 * makes that safe: two pollers, or a retried delivery, race to insert and only
 * one wins. Losing is not an error — it means someone else is running it.
 */
export async function startRun(
  db: Db,
  workflow: WorkflowRow,
  event: TriggerEvent,
): Promise<string | null> {
  const { data, error } = await db
    .from('workflow_runs')
    .insert({
      workflow_id: workflow.id,
      organization_id: workflow.organization_id,
      trigger_data: { event_id: event.id, event_type: event.eventType } as never,
      status: 'running',
    })
    .select('id')
    .single()

  if (error || !data) return null
  return data.id
}

/** Decide what this workflow would do for this payload. */
export function planFor(workflow: WorkflowRow, payload: Record<string, unknown>) {
  return planExecution(parseGraph(workflow.graph), payload)
}

/**
 * Perform one planned step.
 *
 * Conditions, filters and branches were already decided by the planner — they
 * are recorded here, not re-evaluated, so the log matches the walk exactly.
 * Delays are handled by the caller, which is the only place that can suspend.
 */
export async function executeStep(
  db: Db,
  workflow: WorkflowRow,
  step: PlannedStep,
  payload: Record<string, unknown>,
): Promise<StepResult> {
  switch (step.node.type) {
    case 'trigger':
      return { status: 'success' }

    case 'condition':
    case 'filter':
      return {
        status: 'success',
        output: { outcome: step.outcome, halted: step.halted ?? false },
      }

    case 'branch':
      return {
        status: 'success',
        output: { branch: step.branch ?? null, halted: step.halted ?? false },
      }

    case 'delay':
      // The caller sleeps; this only records the outcome.
      return step.delaySeconds === null || step.delaySeconds === undefined
        ? { status: 'skipped', error: 'Delay duration could not be read' }
        : { status: 'success', output: { waited_seconds: step.delaySeconds } }

    default:
      return performAction(db, workflow, step.node, payload)
  }
}

export async function logStep(
  db: Db,
  runId: string,
  orgId: string,
  step: PlannedStep,
  result: StepResult,
  durationMs: number,
): Promise<void> {
  await db.from('workflow_step_logs').insert({
    run_id: runId,
    organization_id: orgId,
    node_id: step.node.id,
    node_type: step.node.type,
    input: { config: step.node.config } as never,
    output: (result.output ?? null) as never,
    status: result.status,
    error: result.error ?? null,
    completed_at: new Date().toISOString(),
    duration_ms: durationMs,
  })
}

export async function finishRun(
  db: Db,
  runId: string,
  outcome: { failed: string | null; truncated: boolean; steps: number; startedAt: number },
): Promise<void> {
  await db
    .from('workflow_runs')
    .update({
      status: outcome.failed ? 'failed' : outcome.truncated ? 'timed_out' : 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - outcome.startedAt,
      error: outcome.failed ?? (outcome.truncated ? 'Step limit reached' : null),
      step_count: outcome.steps,
    })
    .eq('id', runId)
}

/** Load a workflow for the runner, by id, without an org filter (it carries one). */
export async function loadWorkflow(db: Db, workflowId: string): Promise<WorkflowRow | null> {
  const { data } = await db
    .from('workflows')
    .select('id, organization_id, workspace_id, name, trigger_type, trigger_config, graph')
    .eq('id', workflowId)
    .eq('is_active', true)
    .maybeSingle()

  return (data as WorkflowRow | null) ?? null
}

export { triggerMatches }
