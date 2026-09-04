'use server'

import { ORG_MANAGER_ROLES } from '@pm/auth/constants'
import type { ActionResult } from '@pm/shared/types'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Auto-assignment rules (§19.6).
 *
 * The rule is data the background job reads, so everything a form supplies is
 * re-derived here — an unknown method or a pool member who is not an org member
 * would otherwise become a rule that quietly never fires.
 */

const METHODS = ['round_robin', 'load_balanced', 'skill_based', 'random'] as const
const TRIGGERS = ['task_created', 'task_unassigned', 'status_changed'] as const

function automationPath(orgSlug: string) {
  return `/${orgSlug}/settings/automation`
}

export async function saveAssignmentRule(
  orgSlug: string,
  ruleId: string | null,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only managers can manage assignment rules.' }
  }

  const name = String(formData.get('name') ?? '').trim()
  if (!name) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Name is required',
      fieldErrors: { name: ['Name is required'] },
    }
  }

  const method = String(formData.get('method') ?? 'round_robin')
  if (!(METHODS as readonly string[]).includes(method)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown assignment method.' }
  }

  const triggerEvent = String(formData.get('trigger_event') ?? 'task_created')
  if (!(TRIGGERS as readonly string[]).includes(triggerEvent)) {
    return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown trigger.' }
  }

  const isActive = formData.get('is_active') === 'on'
  const pool = formData.getAll('assignee_pool').map(String).filter(Boolean)

  // The database refuses an active rule with an empty pool; say so in words
  // rather than surfacing a constraint name.
  if (isActive && pool.length === 0) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'An active rule needs at least one person to assign to.',
      fieldErrors: { assignee_pool: ['Pick at least one person.'] },
    }
  }

  const supabase = createClient()

  try {
    // A pool id that is not a member of this org would be a rule that assigns
    // work to someone who cannot see it.
    if (pool.length > 0) {
      const { data: members } = await supabase
        .from('org_members')
        .select('user_id')
        .eq('organization_id', auth.orgId)
        .in('user_id', pool)

      const valid = new Set((members ?? []).map((member) => member.user_id))
      if (pool.some((userId) => !valid.has(userId))) {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'One of the selected people is not a member of this organization.',
        }
      }
    }

    const priorities = formData.getAll('priority').map(String).filter(Boolean)
    const labels = String(formData.get('labels') ?? '')
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)

    const conditions: Record<string, unknown> = {}
    if (priorities.length > 0) conditions.priority = priorities
    if (labels.length > 0) conditions.labels = labels

    const config: Record<string, unknown> = {
      respect_leave: formData.get('respect_leave') === 'on',
    }
    const maxConcurrent = Number(formData.get('max_concurrent'))
    if (method === 'load_balanced' && Number.isFinite(maxConcurrent) && maxConcurrent > 0) {
      config.max_concurrent = Math.round(maxConcurrent)
    }
    if (method === 'skill_based') {
      const skills = String(formData.get('required_skills') ?? '')
        .split(',')
        .map((skill) => skill.trim())
        .filter(Boolean)
      if (skills.length > 0) config.required_skills = skills
      config.fallback = 'round_robin'
    }

    const projectId = String(formData.get('project_id') ?? '') || null

    const payload = {
      name: name.slice(0, 120),
      is_active: isActive,
      trigger_event: triggerEvent,
      method,
      assignee_pool: pool,
      conditions: conditions as never,
      config: config as never,
      project_id: projectId,
    }

    if (ruleId) {
      // The round-robin cursor lives in config and belongs to the job, not the
      // form; preserve it across an edit so the rotation does not restart.
      const { data: existing } = await supabase
        .from('auto_assignment_rules')
        .select('config')
        .eq('id', ruleId)
        .eq('organization_id', auth.orgId)
        .maybeSingle()

      const previous = (existing?.config ?? {}) as Record<string, unknown>
      if (typeof previous.last_index === 'number') {
        ;(payload.config as Record<string, unknown>).last_index = previous.last_index
      }

      const { error } = await supabase
        .from('auto_assignment_rules')
        .update(payload)
        .eq('id', ruleId)
        .eq('organization_id', auth.orgId)
      if (error) throw error
    } else {
      const { error } = await supabase.from('auto_assignment_rules').insert({
        ...payload,
        organization_id: auth.orgId,
        created_by: auth.userId,
      })
      if (error) throw error
    }

    revalidatePath(automationPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function setRuleActive(
  orgSlug: string,
  ruleId: string,
  isActive: boolean,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only managers can manage assignment rules.' }
  }

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('auto_assignment_rules')
      .update({ is_active: isActive })
      .eq('id', ruleId)
      .eq('organization_id', auth.orgId)

    if (error) {
      // The CHECK refuses activating a rule with nobody in its pool.
      if (error.code === '23514') {
        return {
          ok: false,
          code: 'VALIDATION_ERROR',
          message: 'Add someone to this rule before activating it.',
        }
      }
      throw error
    }

    revalidatePath(automationPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteAssignmentRule(
  orgSlug: string,
  ruleId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  if (!(ORG_MANAGER_ROLES as readonly string[]).includes(auth.orgRole)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Only managers can manage assignment rules.' }
  }

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('auto_assignment_rules')
      .delete()
      .eq('id', ruleId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(automationPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
