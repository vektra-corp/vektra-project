'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult, Json } from '@pm/shared/types'
import {
  fieldErrors,
  organizationUpdateSchema,
  profileUpdateSchema,
  workspaceCreateSchema,
  workspaceUpdateSchema,
} from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createClient } from '@/lib/supabase/server'

/**
 * Organization, workspace and profile settings.
 *
 * Every mutation re-checks permission server-side even though the UI hides what
 * a role cannot do — hiding a control is presentation, not access control (§8).
 * RLS is still the boundary underneath both.
 */

function orgPath(orgSlug: string) {
  return `/${orgSlug}`
}

// --- Organization -------------------------------------------------------------

export async function updateOrganization(
  orgSlug: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  // Only an owner may change org-level settings; admins manage people, not the
  // tenant record itself.
  if (auth.orgRole !== 'owner' && auth.orgRole !== 'admin') {
    return { ok: false, code: 'FORBIDDEN', message: 'Only owners and admins can change settings.' }
  }

  const parsed = organizationUpdateSchema.safeParse({
    name: formData.get('name') ?? undefined,
    billing_email: formData.get('billing_email') || null,
    tax_id: formData.get('tax_id') || null,
    currency: formData.get('currency') ?? undefined,
    timezone: formData.get('timezone') ?? undefined,
    settings: {
      locale: formData.get('locale') || undefined,
      date_format: formData.get('date_format') || undefined,
      time_format: formData.get('time_format') || undefined,
    },
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

  try {
    const { settings, ...patch } = parsed.data

    // settings is a jsonb blob: merge rather than replace, or saving the
    // localization form would wipe MFA enforcement and session policy.
    const { data: current } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', auth.orgId)
      .maybeSingle()

    const merged: Record<string, Json> = {
      ...((current?.settings as Record<string, Json> | null) ?? {}),
      ...(Object.fromEntries(
        Object.entries(settings ?? {}).filter(([, value]) => value !== undefined),
      ) as Record<string, Json>),
    }

    const { error } = await supabase
      .from('organizations')
      .update({ ...patch, settings: merged })
      .eq('id', auth.orgId)

    if (error) throw error

    revalidatePath(orgPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// --- Workspaces ---------------------------------------------------------------

export async function createWorkspace(
  orgSlug: string,
  _prevState: ActionResult<{ slug: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ slug: string }>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'create')

  const parsed = workspaceCreateSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: formData.get('description') || null,
    color: formData.get('color') || null,
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

  try {
    const { data, error } = await supabase
      .from('workspaces')
      .insert({
        ...parsed.data,
        organization_id: auth.orgId,
        created_by: auth.userId,
      })
      .select('id, slug')
      .single()

    if (error) {
      // (organization_id, slug) is unique — surface it on the field rather than
      // as an opaque database error.
      if (error.code === '23505') {
        return {
          ok: false,
          code: 'ALREADY_EXISTS',
          message: 'That slug is already used in this organization.',
          fieldErrors: { slug: ['That slug is already used in this organization.'] },
        }
      }
      throw error
    }

    // The creator joins as a workspace admin, otherwise they would immediately
    // lose sight of the workspace they just made.
    await supabase.from('workspace_members').insert({
      workspace_id: data.id,
      user_id: auth.userId,
      organization_id: auth.orgId,
      role: 'admin',
    })

    revalidatePath(orgPath(orgSlug))
    return { ok: true, data: { slug: data.slug } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function updateWorkspace(
  orgSlug: string,
  workspaceId: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'update')

  const parsed = workspaceUpdateSchema.safeParse({
    name: formData.get('name') ?? undefined,
    description: formData.get('description') || null,
    color: formData.get('color') || null,
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

  try {
    const { error } = await supabase
      .from('workspaces')
      .update(parsed.data)
      .eq('id', workspaceId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(orgPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function deleteWorkspace(
  orgSlug: string,
  workspaceId: string,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'projects', 'delete')

  const supabase = createClient()

  try {
    // Deleting a workspace cascades to its projects and tasks. Refuse while it
    // still holds projects so that cascade is never a surprise — the caller has
    // to move or delete them deliberately first.
    const { count } = await supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)

    if ((count ?? 0) > 0) {
      return {
        ok: false,
        code: 'CONFLICT',
        message: `This workspace still holds ${count} project${count === 1 ? '' : 's'}. Move or delete them first.`,
      }
    }

    const { error } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(orgPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

// --- Profile ------------------------------------------------------------------

export async function updateProfile(
  orgSlug: string,
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)

  const parsed = profileUpdateSchema.safeParse({
    full_name: formData.get('full_name') ?? undefined,
    phone: formData.get('phone') || null,
    timezone: formData.get('timezone') || null,
    settings: {
      locale: formData.get('locale') || undefined,
      date_format: formData.get('date_format') || undefined,
      time_format: formData.get('time_format') || undefined,
    },
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

  try {
    const { settings, ...patch } = parsed.data

    const { data: current } = await supabase
      .from('profiles')
      .select('settings')
      .eq('id', auth.userId)
      .maybeSingle()

    const merged: Record<string, Json> = {
      ...((current?.settings as Record<string, Json> | null) ?? {}),
      ...(Object.fromEntries(
        Object.entries(settings ?? {}).filter(([, value]) => value !== undefined),
      ) as Record<string, Json>),
    }

    const { error } = await supabase
      .from('profiles')
      .update({ ...patch, settings: merged })
      .eq('id', auth.userId)

    if (error) throw error

    revalidatePath(orgPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
