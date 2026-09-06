'use server'

import { assertCan } from '@pm/auth/rbac'
import { assertPlanLimit, incrementUsage } from '@pm/db'
import { appError } from '@pm/shared/errors'
import type { ActionResult } from '@pm/shared/types'
import { projectKey, publicIdToString } from '@pm/shared/utils'
import { fieldErrors, projectCreateSchema, projectUpdateSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth/context'
import { resolveProject } from '@/lib/route-ids'
import { createClient } from '@/lib/supabase/server'

/**
 * Project mutations.
 *
 * Every action follows the same order (claude.md §9): authenticate, check the
 * permission, validate the input, then write. RLS is still the boundary — these
 * checks only produce a better error than an empty result set.
 *
 * `projectId` arriving from a route is the project's 16-digit public id, so
 * anything that writes resolves it to the uuid first.
 */

/** Postgres unique-violation. The project key has a unique index per org. */
const UNIQUE_VIOLATION = '23505'

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
    key: formData.get('key') || undefined,
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

  // Nobody is asked for a key on the create form; one is derived from the name
  // and can be changed in project settings afterwards.
  const key = parsed.data.key ?? projectKey(parsed.data.name)

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      ...parsed.data,
      key,
      organization_id: auth.orgId,
      created_by: auth.userId,
    })
    .select('id, public_id')
    .single()

  if (error || !project) {
    // Two projects whose names start alike derive the same key. That is a
    // collision between suggestions, not something the person did wrong, so it
    // is reported against the field they can actually change.
    if (error?.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        code: 'ALREADY_EXISTS',
        message: `The key ${key} is already used by another project.`,
        fieldErrors: { key: [`${key} is taken. Choose another.`] },
      }
    }
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

  // The caller redirects to this id, so it must be the one the URL uses.
  return { ok: true, data: { id: publicIdToString(project.public_id) } }
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
    key: formData.get('key') || undefined,
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

  const project = await resolveProject(projectId)
  if (!project) return { ok: false, code: 'NOT_FOUND', message: 'That project was not found.' }

  const supabase = createClient()
  // RLS already confines this to the caller's org; the explicit filter is
  // defence in depth (§22.4 layer 5) and matches every other mutation here.
  const { error } = await supabase
    .from('projects')
    .update(parsed.data)
    .eq('id', project.id)
    .eq('organization_id', auth.orgId)

  if (error) {
    // The key is unique per organization. Say which field, not which index.
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        code: 'ALREADY_EXISTS',
        message: 'That key is already used by another project.',
        fieldErrors: { key: ['Already used by another project in this organization.'] },
      }
    }
    return { ok: false, code: 'INTERNAL_ERROR', message: error.message }
  }

  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects`)
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects/${projectId}`)
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects/${projectId}/settings`)
  return { ok: true, data: null }
}

export async function archiveProject(orgSlug: string, workspaceSlug: string, projectId: string) {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'update')

  const project = await resolveProject(projectId)
  if (!project) return

  const supabase = createClient()
  await supabase
    .from('projects')
    .update({ status: 'archived' })
    .eq('id', project.id)
    .eq('organization_id', auth.orgId)
  revalidatePath(`/${orgSlug}/${workspaceSlug}/projects`)
}
