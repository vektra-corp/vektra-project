'use server'

import { assertCan } from '@pm/auth/rbac'
import type { ActionResult } from '@pm/shared/types'
import { emailSchema } from '@pm/shared/validators'
import { revalidatePath } from 'next/cache'
import { toActionError } from '@/lib/action-error'
import { requireAuth } from '@/lib/auth/context'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

/**
 * External portal user management (§6.1, §18 rule 6).
 *
 * A portal user gets no organization membership and therefore no `org_id`
 * claim. Their entire view of the product comes from rows in
 * `portal_project_access`, so granting access is the only thing that makes a
 * project visible to them.
 */

function portalPath(orgSlug: string) {
  return `/${orgSlug}/settings/portal`
}

export async function invitePortalUser(
  orgSlug: string,
  _prevState: ActionResult<{ email: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ email: string }>> {
  const auth = await requireAuth(orgSlug)
  // Sharing project data outside the organization is a manager-level decision.
  assertCan(auth, 'users', 'update')

  const parsedEmail = emailSchema.safeParse(formData.get('email'))
  const fullName = String(formData.get('full_name') ?? '').trim()

  if (!parsedEmail.success) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Enter a valid email address',
      fieldErrors: { email: ['Enter a valid email address'] },
    }
  }
  if (!fullName) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: 'Name is required',
      fieldErrors: { full_name: ['Name is required'] },
    }
  }

  const email = parsedEmail.data
  const admin = createAdminClient()

  try {
    // Reuse an existing account when there is one, so a client who already has
    // a login is linked rather than sent a second invite that cannot complete.
    const { data: existing } = await admin.rpc('user_id_for_email', { p_email: email })
    let userId = (existing as string | null) ?? null

    if (!userId) {
      const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback?next=/portal/${orgSlug}`
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
        email,
        { redirectTo },
      )
      if (inviteError) return { ok: false, code: 'INTERNAL_ERROR', message: inviteError.message }
      userId = invited.user.id
    }

    const { error } = await admin.from('portal_users').insert({
      organization_id: auth.orgId,
      email,
      full_name: fullName,
      user_id: userId,
      // The account exists the moment it is linked; there is no second
      // acceptance step for a portal user beyond setting a password.
      status: 'active',
      invited_by: auth.userId,
    })

    if (error) {
      if (error.code === '23505') {
        return {
          ok: false,
          code: 'ALREADY_EXISTS',
          message: 'That email already has portal access here.',
          fieldErrors: { email: ['Already invited to this organization.'] },
        }
      }
      throw error
    }

    revalidatePath(portalPath(orgSlug))
    return { ok: true, data: { email } }
  } catch (error) {
    return toActionError(error)
  }
}

export async function setPortalProjectAccess(
  orgSlug: string,
  portalUserId: string,
  projectId: string,
  grant: boolean,
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'users', 'update')

  const supabase = createClient()

  try {
    if (!grant) {
      const { error } = await supabase
        .from('portal_project_access')
        .delete()
        .eq('portal_user_id', portalUserId)
        .eq('project_id', projectId)

      if (error) throw error
      revalidatePath(portalPath(orgSlug))
      return { ok: true, data: null }
    }

    // Both ids are re-checked against this org: the service of record is the
    // database, not the form that submitted them.
    const [{ data: portalUser }, { data: project }] = await Promise.all([
      supabase
        .from('portal_users')
        .select('id')
        .eq('id', portalUserId)
        .eq('organization_id', auth.orgId)
        .maybeSingle(),
      supabase
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('organization_id', auth.orgId)
        .maybeSingle(),
    ])

    if (!portalUser || !project) {
      return { ok: false, code: 'NOT_FOUND', message: 'That user or project was not found.' }
    }

    const { error } = await supabase.from('portal_project_access').insert({
      portal_user_id: portalUserId,
      project_id: projectId,
      // Denormalized for fast RLS checks (§2) — every tenant-scoped row carries it.
      organization_id: auth.orgId,
      // Commenting is the default because a portal that cannot reply is a
      // read-only export; uploading is not, because it consumes storage quota.
      can_comment: true,
      can_upload: false,
      granted_by: auth.userId,
    })

    if (error && error.code !== '23505') throw error

    revalidatePath(portalPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}

export async function setPortalUserStatus(
  orgSlug: string,
  portalUserId: string,
  status: 'active' | 'disabled',
): Promise<ActionResult<null>> {
  const auth = await requireAuth(orgSlug)
  assertCan(auth, 'users', 'update')

  const supabase = createClient()

  try {
    const { error } = await supabase
      .from('portal_users')
      .update({ status })
      .eq('id', portalUserId)
      .eq('organization_id', auth.orgId)

    if (error) throw error

    revalidatePath(portalPath(orgSlug))
    return { ok: true, data: null }
  } catch (error) {
    return toActionError(error)
  }
}
