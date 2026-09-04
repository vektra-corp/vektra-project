'use server'

import { assertCan } from '@pm/auth/rbac'
import { assertPlanLimit, incrementUsage } from '@pm/db'
import { appError } from '@pm/shared/errors'
import type { ActionResult } from '@pm/shared/types'
import { fieldErrors, projectCreateSchema, projectUpdateSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Project mutations.
 *
 * Every action follows the same order (claude.md §9): authenticate, check the
 * permission, validate the input, then write. RLS is still the boundary — these
 * checks only produce a better error than an empty result set.
 */

export async function createProject(
  orgSlug: string,
  workspaceSlug: string,
  _prevState: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'create')

  const supabase = createClient()

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('organization_id', auth.orgId)
    .eq('slug', workspaceSlug)
    .maybeSingle()

  if (!workspace) throw appError('NOT_FOUND', 'Workspace not found')

  const parsed = projectCreateSchema.safeParse({
    workspace_id: workspace.id,
    name: formData.get('name'),
    description: formData.get('description') || null,
    priority: formData.get('priority') || 'medium',
    start_date: formData.get('start_date') || null,
    end_date: formData.get('end_date') || null,
    visibility: formData.get('visibility') || 'workspace',
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  await assertPlanLimit(supabase, auth.orgId, 'projects')

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      ...parsed.data,
      organization_id: auth.orgId,
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (error || !project) {
    return { ok: false, code: 'INTERNAL_ERROR', message: error?.message ?? 'Could not create' }
  }

  // The creator is the project owner; without this they would not appear in
  // project_members and could lose access to their own project.
  await supabase.from('project_members').insert({
    project_id: project.id,
    user_id: auth.userId,
    organization_id: auth.orgId,
    role: 'owner',
  })

  await incrementUsage(supabase, auth.orgId, 'projects')
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects`)

  return { ok: true, data: { id: project.id } }
}

export async function updateProject(
  orgSlug: string,
  workspaceSlug: string,
  projectId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'update')

  const parsed = projectUpdateSchema.safeParse({
    name: formData.get('name') ?? undefined,
    description: formData.get('description') ?? undefined,
    status: formData.get('status') ?? undefined,
    priority: formData.get('priority') ?? undefined,
    start_date: formData.get('start_date') || null,
    end_date: formData.get('end_date') || null,
  })

  if (!parsed.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'VALIDATION_ERROR',
      fieldErrors: fieldErrors(parsed.error),
    }
  }

  const supabase = createClient()
  // RLS already confines this to the caller's org; the explicit filter is
  // defence in depth (§22.4 layer 5) and matches every other mutation here.
  const { error } = await supabase
    .from('projects')
    .update(parsed.data)
    .eq('id', projectId)
    .eq('organization_id', auth.orgId)
  if (error) return { ok: false, code: 'INTERNAL_ERROR', message: error.message }

  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects`)
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects/${projectId}`)
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects/${projectId}/settings`)
  return { ok: true, data: null }
}

export async function archiveProject(orgSlug: string, workspaceSlug: string, projectId: string) {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'update')

  const supabase = createClient()
  await supabase
    .from('projects')
    .update({ status: 'archived' })
    .eq('id', projectId)
    .eq('organization_id', auth.orgId)
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects`)
}
