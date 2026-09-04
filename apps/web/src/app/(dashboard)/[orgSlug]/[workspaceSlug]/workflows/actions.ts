'use server'

import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import {
  WORKFLOW_TRIGGER_TYPES,
  parseGraph,
  validateGraph,
  type WorkflowTriggerType,
} from '@pm/shared/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
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
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
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

    const cron = String(formData.get('cron_expression') ?? '').trim()
    // The schema requires a cron expression for a scheduled workflow; catch it
    // here so the message names the field rather than a constraint.
    if (triggerType === 'schedule' && !cron) {
      return {
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'A scheduled workflow needs a cron expression.',
        fieldErrors: { cron_expression: ['Required for a schedule trigger.'] },
      }
    }

    const { data, error } = await supabase
      .from('workflows')
      .insert({
        organization_id: auth.orgId,
        workspace_id: workspace.id,
        name: name.slice(0, 120),
        description: String(formData.get('description') ?? '').trim() || null,
        trigger_type: triggerType as WorkflowTriggerType,
        cron_expression: triggerType === 'schedule' ? cron : null,
        // A new workflow starts inactive: it has no graph yet, so activating it
        // could only ever be a mistake. The webhook token is minted by a trigger.
        is_active: false,
      })
      .select('id')
      .single()

    if (error) throw error

    revalidatePath(workflowsPath(scope))
    return { ok: true, data: { id: data.id } }
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
