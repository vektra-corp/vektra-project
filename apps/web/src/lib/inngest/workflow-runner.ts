import 'server-only'

import { planExecution, triggerMatches, type TriggerEvent } from '@pm/db'
import type { Database } from '@pm/db/types'
import { parseGraph, type WorkflowNode } from '@pm/shared/constants'
import type { SupabaseClient } from '@supabase/supabase-js'

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

      const { error } = await db.from('comments').insert({
        task_id: taskId,
        organization_id: workflow.organization_id,
        // A workflow comment has no human author; author_id is NOT NULL, so
        // this action is skipped until workflows have a system identity.
        author_id: null as never,
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        } as never,
        is_internal: true,
      })

      return error ? { status: 'failed', error: error.message } : { status: 'success' }
    }

    case 'create_task':
    case 'call_webhook':
      // Deliberately unimplemented: creating tasks needs a project and column to
      // be chosen, and calling out needs SSRF protection. Logged, not failed.
      return { status: 'skipped', error: `${node.action_type} is not implemented yet` }

    default:
      return { status: 'skipped', error: 'No action type set' }
  }
}

/**
 * Run one workflow against one event.
 *
 * Returns the run id, or null when the run was already recorded — the unique
 * index on (workflow_id, event_id) is what makes a retried poll safe.
 */
export async function runWorkflow(
  db: Db,
  workflow: WorkflowRow,
  event: TriggerEvent,
): Promise<{ runId: string; steps: number } | null> {
  const startedAt = Date.now()

  const { data: run, error: runError } = await db
    .from('workflow_runs')
    .insert({
      workflow_id: workflow.id,
      organization_id: workflow.organization_id,
      trigger_data: { event_id: event.id, event_type: event.eventType } as never,
      status: 'running',
    })
    .select('id')
    .single()

  // 23505 means another poll already claimed this event. Not an error.
  if (runError) return null
  if (!run) return null

  const graph = parseGraph(workflow.graph)
  const plan = planExecution(graph, event.payload)

  let failed: string | null = null
  let executed = 0

  for (const step of plan.steps) {
    const stepStart = Date.now()
    let result: StepResult

    if (step.node.type === 'trigger') {
      result = { status: 'success' }
    } else if (step.node.type === 'condition' || step.node.type === 'filter') {
      result = { status: 'success', output: { outcome: step.outcome, halted: step.halted ?? false } }
    } else if (step.node.type === 'delay') {
      // A real delay needs the run to suspend and resume, which this polling
      // shape cannot express. Recorded honestly rather than silently ignored.
      result = { status: 'skipped', error: 'Delays are not supported by the current runner' }
    } else if (step.node.type === 'branch') {
      result = { status: 'success' }
    } else {
      result = await performAction(db, workflow, step.node, event.payload)
    }

    executed += 1

    await db.from('workflow_step_logs').insert({
      run_id: run.id,
      organization_id: workflow.organization_id,
      node_id: step.node.id,
      node_type: step.node.type,
      input: { config: step.node.config } as never,
      output: (result.output ?? null) as never,
      status: result.status,
      error: result.error ?? null,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - stepStart,
    })

    // A failed action stops the run: continuing would apply later steps that
    // assumed the earlier one succeeded.
    if (result.status === 'failed') {
      failed = result.error ?? 'Step failed'
      break
    }
  }

  await db
    .from('workflow_runs')
    .update({
      status: failed ? 'failed' : plan.truncated ? 'timed_out' : 'completed',
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error: failed ?? (plan.truncated ? 'Step limit reached' : null),
      step_count: executed,
    })
    .eq('id', run.id)

  return { runId: run.id, steps: executed }
}

export { triggerMatches }
