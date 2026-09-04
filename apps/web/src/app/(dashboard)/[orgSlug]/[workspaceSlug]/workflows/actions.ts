'use server'

import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  WORKFLOW_TRIGGER_TYPES,
  parseGraph,
  parseSchedule,
  scheduleToCron,
  validateGraph,
  type WorkflowTriggerType,
} from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { mintWebhookToken } from '@/lib/net/webhook-token'
import { createClient } from '@/lib/supabase/server'

/**
 * Workflow definitions (§6.5, §11).
 *
 * The graph is validated on every save and again before activation. A workflow
 * that fails validation can still be SAVED as a draft — half-built graphs are
 * normal while editing — but it cannot be made active, because the engine's
 * step cap is a cost guard, not a correctness check.
 */

interface Scope {
  orgSlug: string
  workspaceSlug: string
}

function workflowsPath(scope: Scope) {
  return `/${scope.orgSlug}/${scope.workspaceSlug}/workflows`
}

async function assertManager(orgSlug: string) {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    throw Object.assign(new Error('Only managers can manage workflows.'), { code: 'FORBIDDEN' })
  }
  return auth
}

export async function createWorkflow(
  scope: Scope,
  _prevState: ActionResult<{ id: string; webhookToken?: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; webhookToken?: string }>> {
  try {
    const auth = await assertManager(scope.orgSlug)

    const name = String(formData.get('name') ?? '').trim()
    if (!name) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Name is required',
        fieldErrors: { name: ['Name is required'] },
      }
    }

    const triggerType = String(formData.get('trigger_type') ?? 'task_event')
    if (!(WORKFLOW_TRIGGER_TYPES as readonly string[]).includes(triggerType)) {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown trigger type.' }
    }

    const supabase = createClient()

    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id')
      .eq('organization_id', auth.orgId)
      .eq('slug', scope.workspaceSlug)
      .maybeSingle()

    if (!workspace) return { ok: false, code: 'NOT_FOUND', message: 'Workspace not found.' }

    // A schedule is captured structurally (frequency + time) and the cron
    // string is derived from it. The DB still requires cron_expression for a
    // scheduled workflow, and the scheduler reads the structure — so both are
    // written, from one source.
    const schedule = parseSchedule({
      frequency: formData.get('schedule_frequency'),
      hour: formData.get('schedule_hour'),
      minute: formData.get('schedule_minute'),
      weekday: formData.get('schedule_weekday'),
      day: formData.get('schedule_day'),
    })

    // The mint trigger was dropped in 00025 — the token is hashed now, so it
    // has to be generated here, where the plaintext can be handed back once.
    const minted = triggerType === 'webhook' ? mintWebhookToken() : null

    const { data, error } = await supabase
      .from('workflows')
      .insert({
        organization_id: auth.orgId,
        workspace_id: workspace.id,
        name: name.slice(0, 120),
        description: String(formData.get('description') ?? '').trim() || null,
        trigger_type: triggerType as WorkflowTriggerType,
        trigger_config: triggerType === 'schedule' ? { schedule: { ...schedule } } : {},
        cron_expression: triggerType === 'schedule' ? scheduleToCron(schedule) : null,
        webhook_token_hash: minted?.hash ?? null,
        // A new workflow starts inactive: it has no graph yet, so activating it
        // could only ever be a mistake.
        is_active: false,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(workflowsPath(scope))
    // The plaintext token travels back exactly once, in this response. It is
    // not stored and cannot be re-read.
    return { ok: true, data: { id: data.id, webhookToken: minted?.token } }
  } catch (error) {
    return toActionError(error)
  }
}

/**
 * Mint a fresh trigger token, invalidating the old one.
 *
 * Rotation is the only way to see a token again, which is the point: a stored
 * plaintext is a stored credential. Manager-gated like every other change to a
 * workflow.
 */
export async function rotateWebhookToken(
  scope: Scope,
  workflowId: string,
): Promise<ActionResult<{ token: string }>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    const { data: workflow } = await supabase
      .from('workflows')
      .select('id, trigger_type')
      .eq('id', workflowId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!workflow) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found.' }
    if (workflow.trigger_type !== 'webhook') {
      return { ok: false, code: 'VALIDATION_ERROR', message: 'This workflow is not webhook-triggered.' }
    }

    const minted = mintWebhookToken()
    const { error } = await supabase
      .from('workflows')
      .update({ webhook_token_hash: minted.hash })
      .eq('id', workflowId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`${workflowsPath(scope)}/${workflowId}`)
    return { ok: true, data: { token: minted.token } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function saveWorkflowGraph(
  scope: Scope,
  workflowId: string,
  rawGraph: unknown,
): Promise<ActionResult<{ problems: number }>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    // Re-parsed rather than trusted: the editor sends whatever is on the canvas,
    // including nodes someone may have half-configured.
    const graph = parseGraph(rawGraph)
    const problems = validateGraph(graph)

    const { data: existing } = await supabase
      .from('workflows')
      .select('is_active')
      .eq('id', workflowId)
      .eq('organization_id', auth.orgId)
      .maybeSingle()

    if (!existing) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found.' }

    // An active workflow must never hold an invalid graph, so a bad save
    // deactivates it rather than leaving the engine to trip over it.
    const { error } = await supabase
      .from('workflows')
      .update({
        graph: graph as never,
        ...(problems.length > 0 && existing.is_active ? { is_active: false } : {}),
      })
      .eq('id', workflowId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(`${workflowsPath(scope)}/${workflowId}`)
    return { ok: true, data: { problems: problems.length } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function setWorkflowActive(
  scope: Scope,
  workflowId: string,
  isActive: boolean,
): Promise<ActionResult<null>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    if (isActive) {
      const { data: workflow } = await supabase
        .from('workflows')
        .select('graph')
        .eq('id', workflowId)
        .eq('organization_id', auth.orgId)
        .maybeSingle()

      if (!workflow) return { ok: false, code: 'NOT_FOUND', message: 'Workflow not found.' }

      const problems = validateGraph(parseGraph(workflow.graph))
      if (problems.length > 0) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message:
            problems[0]!.message +
            (problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''),
        }
      }
    }

    const { error } = await supabase
      .from('workflows')
      .update({ is_active: isActive })
      .eq('id', workflowId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(workflowsPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteWorkflow(
  scope: Scope,
  workflowId: string,
): Promise<ActionResult<null>> {
  try {
    const auth = await assertManager(scope.orgSlug)
    const supabase = createClient()

    const { error } = await supabase
      .from('workflows')
      .delete()
      .eq('id', workflowId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(workflowsPath(scope))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
